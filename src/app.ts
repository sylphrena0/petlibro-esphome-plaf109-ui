import { LitElement, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { ENTITIES, type Entity, entityId } from "./entities";
import { renderTemplate } from "./template";

if (!document.querySelector('meta[name="viewport"]')) {
  const viewport = document.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  document.head.appendChild(viewport);
}
if (!document.documentElement.lang) document.documentElement.lang = "en";

interface EntityState {
  id: string;
  state?: string;
  value?: string | number | boolean | null;
  min_value?: string;
  max_value?: string;
  step?: string;
}

function formatUptime(totalSeconds: number): string {
  const hour = Math.floor(totalSeconds / 3600);
  const min = Math.floor((totalSeconds % 3600) / 60);
  const sec = Math.floor(totalSeconds % 60);
  if (hour > 0) return `Uptime ${hour}h ${min}m`;
  if (min > 0) return `Uptime ${min}m ${sec}s`;
  return `Uptime ${sec}s`;
}

const timeFormat = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });

function formatLastVisitAt(raw: string | undefined): string | null {
  const dttm = raw ? new Date(raw) : null;
  if (!dttm || Number.isNaN(dttm.getTime())) return null;
  const time = timeFormat.format(dttm);
  if (dttm.toDateString() === new Date().toDateString()) return time;
  return dttm.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + time;
}

const durationFormat = new Intl.DurationFormat([], { style: "narrow" });

function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const duration: Partial<Record<Intl.DurationFormatUnit, number>> = {
    hours: Math.floor(s / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
  return durationFormat.format(duration) || "0s";
}

// Strips the "(config hash 0x...)" part out of the version.text_sensor state
const FIRMWARE_VERSION_RE = /^([^\s(]+)(?:\s*\(config hash 0x[0-9a-f]+)?(?:,\s*(built[^)]*))?\)?$/i;

function formatFirmwareVersion(raw: string): string {
  const m = FIRMWARE_VERSION_RE.exec(raw);
  if (!m) return raw;
  return m[2] ? `${m[1]}, ${m[2]}` : (m[1] ?? raw);
}

function parseTimeToMinutes(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const parts = value.split(":");
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function decimalsOf(n: number): number {
  const s = String(n);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

// Intl duration units, each split into the next unit up, so 90 minutes shows as "1 hr 30 min"
const LARGER_UNIT: Partial<Record<string, string>> = { second: "minute", minute: "hour" };

/** Short local unit format, e.g. "45 min" */
function unitFormat(unit: string): Intl.NumberFormat {
  return new Intl.NumberFormat([], { style: "unit", unit, unitDisplay: "short" });
}

/**
 * Formats with as many decimals as `step`, so step 0.5 shows "40.5"
 * @param unit an Intl duration unit ("minute", "second"), or a suffix such as "°"
 * @param zeroText replaces the whole text at 0, for numbers where 0 means "disabled"
 */
function formatNumber(n: number, step: number, unit: string, zeroText?: string): string {
  if (n === 0 && zeroText !== undefined) return zeroText;
  if (!Number.isFinite(n)) return "--";
  const larger = LARGER_UNIT[unit];
  if (!larger) return n.toFixed(decimalsOf(step)) + unit;
  const big = Math.floor(n / 60);
  const rest = n % 60;
  if (!big) return unitFormat(unit).format(rest);
  const bigText = unitFormat(larger).format(big);
  return rest ? `${bigText} ${unitFormat(unit).format(rest)}` : bigText;
}

/** The unit as typed after a number, e.g. "min" */
function unitLabel(unit: string): string {
  if (!LARGER_UNIT[unit]) return unit;
  return unitFormat(unit).formatToParts(1).find((part) => part.type === "unit")?.value ?? unit;
}

interface NextMeal {
  index: number | null; // null when no meal is coming up
  label: string;
  timeText: string;
}

export class PlaRemote extends LitElement {
  private editing?: string; // entity id of the focused number or time input
  private pendingMealTime?: { value: string; meal: Entity; index: number; timer: ReturnType<typeof setTimeout> };
  private confirmed: Record<string, EntityState> = {}; // last state from the device, without optimistic values
  private eventSource?: EventSource;
  private nextMealTimer?: ReturnType<typeof setInterval>;
  private uptimeTimer?: ReturnType<typeof setInterval>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private uptimeBaseSeconds?: number;
  private uptimeBaseAt?: number;

  @state() private store: Record<string, EntityState> = {};
  @state() deviceTitle = "PLAF109";
  @state() connected = false;
  @state() connLabel = "Connecting…";
  @state() toast: { text: string; info: boolean } | null = null;
  @state() showSettingsHelp = false;

  protected override createRenderRoot(): this {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.connectSSE();
    // meal times don't change every tick, but "next" does as the clock moves past one
    this.nextMealTimer = setInterval(() => this.requestUpdate(), 30000);
    this.uptimeTimer = setInterval(() => this.renderUptime(), 1000);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.nextMealTimer) clearInterval(this.nextMealTimer);
    if (this.uptimeTimer) clearInterval(this.uptimeTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.eventSource) this.eventSource.close();
    this.toast = null;
    this.setConnected(false);
    this.editing = undefined;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") this.saveMealTime(false);
  };

  override render(): TemplateResult {
    return renderTemplate(this);
  }

  private entityState(entity: Entity): EntityState | undefined {
    return this.store[entityId(entity)];
  }

  private num(entity: Entity): number {
    const value = this.entityState(entity)?.value;
    return typeof value === "number" || (typeof value === "string" && value !== "") ? Number(value) : Number.NaN;
  }

  private str(entity: Entity): string | undefined {
    const value = this.entityState(entity)?.value;
    return typeof value === "string" ? value : undefined;
  }

  isOn(entity: Entity): boolean {
    const state = this.entityState(entity);
    return state?.value === true || state?.state === "ON";
  }

  // web_server sends state "NA" for a sensor with no reading (NaN), e.g. until it first publishes after boot
  stateText(entity: Entity, fallback = "--"): string {
    const text = this.entityState(entity)?.state;
    return text && text !== "NA" ? text : fallback;
  }

  numText(entity: Entity, unit: string, zeroText?: string): string {
    return formatNumber(this.num(entity), this.stepOf(entity), unit, zeroText);
  }

  // null when no meal was missed
  get missedMealReason(): string | null {
    return this.str(ENTITIES.missedMealReason) || null;
  }

  get onBattery(): boolean {
    return !!this.entityState(ENTITIES.acPower) && !this.isOn(ENTITIES.acPower);
  }

  get batteryLow(): boolean {
    const pct = this.num(ENTITIES.battery);
    return this.onBattery && Number.isFinite(pct) && pct <= 15;
  }

  get batteryPctText(): string {
    const pct = this.num(ENTITIES.battery);
    return Number.isFinite(pct) ? Math.round(pct) + "%" : "--%";
  }

  get presenceText(): string {
    if (!this.entityState(ENTITIES.presence)) return "--";
    return this.isOn(ENTITIES.presence) ? "Here" : "Away";
  }

  get lastVisitDurationText(): string {
    const s = this.num(ENTITIES.lastVisitDuration);
    return Number.isFinite(s) ? formatDuration(s) : "--";
  }

  get lastVisitAtText(): string | null {
    return formatLastVisitAt(this.entityState(ENTITIES.lastVisitTime)?.state);
  }

  get totalVisitText(): string {
    const s = this.num(ENTITIES.totalVisitTime);
    return Number.isFinite(s) ? formatDuration(s) : "--";
  }

  get firmwareVersionText(): string {
    const d = this.entityState(ENTITIES.firmwareVersion);
    if (!d) return "—";
    return d.state ? formatFirmwareVersion(d.state) : "--";
  }

  get nextMeal(): NextMeal {
    const schedule = this.entityState(ENTITIES.schedule);
    if (schedule && !this.isOn(ENTITIES.schedule)) return { index: null, label: "Schedule disabled", timeText: "Off" };

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let best: { index: number; name: string; until: number; minutes: number } | null = null;
    for (const [index, meal] of ENTITIES.feedTimes.entries()) {
      const minutes = parseTimeToMinutes(this.str(meal));
      if (minutes === null) continue;
      let until = minutes - nowMin;
      if (until < 0) until += 24 * 60; // already passed today
      if (best === null || until < best.until) best = { index, name: meal.name, until, minutes };
    }

    if (!best) return { index: null, label: "", timeText: "--:--" };
    const at = new Date(now);
    at.setHours(Math.floor(best.minutes / 60), best.minutes % 60, 0, 0);
    return { index: best.index, label: best.name, timeText: timeFormat.format(at) };
  }

  private stepOf(entity: Entity): number {
    const step = Number(this.entityState(entity)?.step);
    return step > 0 ? step : 1;
  }

  private rangeOf(entity: Entity): { min: number; max: number; step: number } {
    const cur = this.entityState(entity);
    return {
      min: cur?.min_value !== undefined ? Number(cur.min_value) : -Infinity,
      max: cur?.max_value !== undefined ? Number(cur.max_value) : Infinity,
      step: this.stepOf(entity),
    };
  }

  /** Parses "10", "10 min", or `zeroText` as 0, rounded to the step */
  private parseNumberInput(
    entity: Entity,
    raw: string,
    unit: string,
    zeroText?: string,
  ): { value: number; rounded: boolean } | { error: string } {
    const text = raw.trim().toLowerCase();
    const label = unitLabel(unit).toLowerCase();
    let value = Number.NaN;
    if (text === zeroText?.toLowerCase()) {
      value = 0;
    } else {
      const numberText = text.endsWith(label) ? text.slice(0, -label.length).trim() : text;
      if (numberText !== "") value = Number(numberText);
    }
    if (!Number.isFinite(value)) return { error: "Enter a number" };

    const { min, max, step } = this.rangeOf(entity);
    if (value < min || value > max) {
      return { error: `Must be between ${formatNumber(min, step, unit)} and ${formatNumber(max, step, unit)}` };
    }
    const base = Number.isFinite(min) ? min : 0;
    const steps = (value - base) / step;
    if (Math.abs(steps - Math.round(steps)) <= 1e-9) return { value, rounded: false };
    return { value: Math.min(max, base + Math.round(steps) * step), rounded: true };
  }

  /** Sends an action to the device, resolving true on success */
  private async post(entity: Entity, action: string, query?: string): Promise<boolean> {
    let url = "/" + entity.domain + "/" + encodeURIComponent(entity.name) + "/" + action;
    if (query) url += "?" + query;
    try {
      const res = await fetch(url, { method: "POST", credentials: "same-origin", keepalive: true });
      if (res.ok) return true;
      this.showToast(`Failed to save, server returned ${res.status}`);
    } catch (err) {
      console.error("PLAF109 remote: request failed", url, err);
      this.showToast("Failed to save, request failed");
    }
    return false;
  }

  private showToast(text: string, info = false): void {
    this.toast = { text, info };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), 5000);
  }

  /** Subscribes to the device's state and ping events */
  private connectSSE(): void {
    const eventSource = new EventSource("/events");
    eventSource.addEventListener("state", (e: Event) => {
      const event = e as MessageEvent<string>;
      let state: EntityState;
      try {
        state = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!state?.id) return;
      const merged = { ...this.confirmed[state.id], ...state };
      this.confirmed[state.id] = merged;
      this.store = { ...this.store, [state.id]: merged };
    });
    eventSource.addEventListener("ping", (e: Event) => {
      const event = e as MessageEvent<string>;
      try {
        const { title, uptime }: { title?: string; uptime?: number } = JSON.parse(event.data);
        if (typeof title === "string") this.deviceTitle = document.title = title;
        if (typeof uptime === "number") {
          this.uptimeBaseSeconds = uptime;
          this.uptimeBaseAt = Date.now();
          this.renderUptime();
        }
      } catch {
        return;
      }
    });
    eventSource.addEventListener("open", () => this.setConnected(true));
    eventSource.onerror = () => this.setConnected(false);
    this.eventSource = eventSource;
  }

  private setConnected(ok: boolean): void {
    this.connected = ok;
    if (!ok) {
      this.connLabel = "Reconnecting…";
    } else {
      this.renderUptime();
    }
  }

  private renderUptime(): void {
    if (!this.connected || this.uptimeBaseSeconds === undefined || this.uptimeBaseAt === undefined) return;
    const elapsed = this.uptimeBaseSeconds + Math.floor((Date.now() - this.uptimeBaseAt) / 1000);
    this.connLabel = formatUptime(elapsed);
  }

  /** Meal time as HH:MM for <input type=time> */
  mealTimeValue(meal: Entity): string {
    return this.str(meal)?.slice(0, 5) ?? "";
  }

  /**
   * Error if a new meal time is out of order with its neighboring meals
   * @param index the meal being set
   * @param minutes its new time, in minutes since midnight
   */
  private mealOrderError(index: number, minutes: number): string | null {
    const meals = ENTITIES.feedTimes.map((meal: Entity) => {
      const value = this.confirmed[entityId(meal)]?.value;
      return { name: meal.name, minutes: parseTimeToMinutes(typeof value === "string" ? value : undefined) };
    });
    const name = meals[index]?.name;
    // a neighbor still at this meal's time was never set, e.g. all at 00:00 after flashing
    const isSet = (m: { minutes: number | null }) => m.minutes !== null && m.minutes !== meals[index]?.minutes;
    const before = meals.slice(0, index).reverse().find(isSet);
    const after = meals.slice(index + 1).find(isSet);
    if (before && minutes <= (before.minutes ?? -1)) return `${name} must be after ${before.name}`;
    if (after && minutes >= (after.minutes ?? 24 * 60)) return `${name} must be before ${after.name}`;
    return null;
  }

  /**
   * Whether any scheduled meal starts too soon after the previous one, wrapping from Meal Three to Meal One
   * @param gap minimum minutes between meal starts
   */
  private mealsOverlap(gap: number): boolean {
    if (!this.isOn(ENTITIES.schedule)) return false;
    const starts = ENTITIES.feedTimes.map((meal) => parseTimeToMinutes(this.str(meal)));
    return starts.some((start, i) => {
      const next = starts[(i + 1) % starts.length];
      return start !== null && next != null && (next - start + 24 * 60) % (24 * 60) < gap;
    });
  }

  private get feedingMinutes(): number {
    return this.num(ENTITIES.minimumFeedingTime) || 0;
  }

  /**
   * Error text when the feeding time alone runs into the next meal
   * @returns null when no meals overlap
   */
  get mealOverlapError(): string | null {
    if (!this.mealsOverlap(this.feedingMinutes)) return null;
    return "Meal(s) are less than the feeding time apart, so this schedule will cause a meal will be skipped.";
  }

  /**
   * Warning text when a meal could run into the next meal by waiting out the arrival timeout
   * @returns null when no meals could overlap, or when the error is already shown
   */
  get mealOverlapWarning(): string | null {
    if (this.mealOverlapError) return null;
    if (!this.mealsOverlap((this.num(ENTITIES.arrivalTimeout) || 0) + this.feedingMinutes)) return null;
    return `Meals are less than the arrival timeout plus feeding time apart, so a meal might be skipped.`;
  }

  get longArrivalTimeout(): boolean {
    return this.num(ENTITIES.arrivalTimeout) > 4 * 60;
  }

  toggleSettingsHelp(): void {
    this.showSettingsHelp = !this.showSettingsHelp;
  }

  pressButton(entity: Entity): void {
    void this.post(entity, "press");
  }

  // Lit only re-sets .checked when the rendered value changes, so undo a rejected toggle manually
  async setSwitch(e: Event, entity: Entity): Promise<void> {
    const input = e.target as HTMLInputElement;
    const ok = await this.post(entity, input.checked ? "turn_on" : "turn_off");
    if (!ok) input.checked = this.isOn(entity);
  }

  stepNumberEntity(entity: Entity, direction: 1 | -1): void {
    const curVal = this.num(entity);
    if (!Number.isFinite(curVal)) return;
    const { min, max, step } = this.rangeOf(entity);
    const next = Math.min(max, Math.max(min, curVal + direction * step));
    void this.setValue(entity, next.toFixed(decimalsOf(step)));
  }

  /** Updates the store immediately, reverting if the device rejects it */
  private async setValue(entity: Entity, value: string): Promise<void> {
    const id = entityId(entity);
    const optimistic = { ...this.store[id], id, value, state: value };
    this.store = { ...this.store, [id]: optimistic };
    const ok = await this.post(entity, "set", "value=" + encodeURIComponent(value));
    if (ok || this.store[id] !== optimistic) return;
    const store = { ...this.store };
    const confirmed = this.confirmed[id];
    if (confirmed) store[id] = confirmed;
    else delete store[id];
    this.store = store;
  }

  isEditing(entity: Entity): boolean {
    return this.editing === entityId(entity);
  }

  onEditFocus(entity: Entity): void {
    this.editing = entityId(entity);
  }

  onEditKeydown(e: KeyboardEvent): void {
    const input = e.target as HTMLInputElement;
    if (e.key === "Escape") {
      this.editing = undefined; // makes the number change handler skip it
      if (this.pendingMealTime) clearTimeout(this.pendingMealTime.timer);
      this.pendingMealTime = undefined;
    }
    if (e.key === "Enter" || e.key === "Escape") input.blur();
  }

  /** Restores the formatted stored value */
  onEditBlur(): void {
    this.editing = undefined;
    this.requestUpdate();
  }

  /** Shows the bare number while typing */
  onNumberFocus(e: Event, entity: Entity): void {
    const input = e.target as HTMLInputElement;
    this.onEditFocus(entity);
    const n = this.num(entity);
    input.value = Number.isFinite(n) ? n.toFixed(decimalsOf(this.stepOf(entity))) : "";
    input.select();
  }

  /**
   * Saves a typed number, rounded to the step
   * @param zeroText typed in place of 0, e.g. "Off"
   */
  onNumberChange(e: Event, entity: Entity, unit: string, zeroText?: string): void {
    const input = e.target as HTMLInputElement;
    if (!this.isEditing(entity) || input.value.trim() === "") return; // blur puts the current value back
    const result = this.parseNumberInput(entity, input.value, unit, zeroText);
    if ("error" in result) {
      this.showToast(result.error);
      return;
    }
    const step = this.stepOf(entity);
    if (result.rounded) {
      const stepText = formatNumber(step, step, unit);
      this.showToast(`Rounded to ${formatNumber(result.value, step, unit, zeroText)}, entity accepts steps of ${stepText}`, true);
    }
    if (result.value !== this.num(entity)) void this.setValue(entity, result.value.toFixed(decimalsOf(step)));
  }

  /** Debounces saves, as change fires per typed segment, but saves right away once the input has lost focus */
  onMealTimeChange(e: Event, meal: Entity, index: number): void {
    if (this.pendingMealTime?.meal !== meal) this.saveMealTime(true);
    if (this.pendingMealTime) clearTimeout(this.pendingMealTime.timer);
    const timer = setTimeout(() => this.saveMealTime(false), 2000);
    this.pendingMealTime = { value: (e.target as HTMLInputElement).value, meal, index, timer };
    if (!this.isEditing(meal)) this.saveMealTime(true);
  }

  onMealTimeBlur(): void {
    this.saveMealTime(true);
    this.onEditBlur();
  }

  /**
   * Saves the changed meal time, if any
   * @param final shows why an out-of-order time wasn't saved, instead of waiting for more typing
   */
  private saveMealTime(final: boolean): void {
    const pending = this.pendingMealTime;
    if (!pending) return;
    clearTimeout(pending.timer);
    const { value, meal, index } = pending;
    const minutes = parseTimeToMinutes(value);
    const error = minutes === null ? null : this.mealOrderError(index, minutes);
    if (error && !final) return;
    this.pendingMealTime = undefined;
    if (minutes === null || value === this.mealTimeValue(meal)) return;
    if (!error) {
      void this.setValue(meal, value + ":00");
      return;
    }
    this.showToast(error);
    this.requestUpdate(); // puts back the stored time if the input no longer has focus
  }
}

customElements.define("esp-app", PlaRemote);
