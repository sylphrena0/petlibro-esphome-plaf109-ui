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

interface NextMeal {
  index: number | null; // null when no meal is coming up
  label: string;
  timeText: string;
}

export class PlaRemote extends LitElement {
  private editingMealTime: Record<number, boolean> = {};
  private eventSource?: EventSource;
  private nextMealTimer?: ReturnType<typeof setInterval>;
  private uptimeTimer?: ReturnType<typeof setInterval>;
  private errorTimer?: ReturnType<typeof setTimeout>;
  private uptimeBaseSeconds?: number;
  private uptimeBaseAt?: number;

  @state() private store: Record<string, EntityState> = {};
  @state() deviceTitle = "PLAF109";
  @state() connected = false;
  @state() connLabel = "Connecting…";
  @state() errorText: string | null = null;
  @state() showSettingsHelp = false;
  // Separate from the store so a state event can't overwrite a time the user is editing
  @state() mealTimes: string[] = ENTITIES.feedTimes.map(() => "");

  protected override createRenderRoot(): this {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.connectSSE();
    // meal times don't change every tick, but "next" does as the clock moves past one
    this.nextMealTimer = setInterval(() => this.requestUpdate(), 30000);
    this.uptimeTimer = setInterval(() => this.renderUptime(), 1000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.nextMealTimer) clearInterval(this.nextMealTimer);
    if (this.uptimeTimer) clearInterval(this.uptimeTimer);
    if (this.errorTimer) clearTimeout(this.errorTimer);
    if (this.eventSource) this.eventSource.close();
    this.errorText = null;
    this.setConnected(false);
    this.editingMealTime = {};
  }

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

  // Formatted with as many decimals as the number entity's step, so step: 0.5 shows "40.5"
  // `zeroText` replaces the whole text at 0, for numbers where 0 means "disabled"
  numText(entity: Entity, suffix: string, zeroText?: string): string {
    const n = this.num(entity);
    if (n === 0 && zeroText !== undefined) return zeroText;
    return (Number.isFinite(n) ? n.toFixed(decimalsOf(this.stepOf(entity))) : "--") + suffix;
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

  // Resolves to whether the device accepted the request
  private async post(entity: Entity, action: string, query?: string): Promise<boolean> {
    let url = "/" + entity.domain + "/" + encodeURIComponent(entity.name) + "/" + action;
    if (query) url += "?" + query;
    try {
      const res = await fetch(url, { method: "POST", credentials: "same-origin" });
      if (res.ok) return true;
      this.showError(`${entity.name}: error code ${res.status}`);
    } catch (err) {
      console.error("PLAF109 remote: request failed", url, err);
      this.showError(`${entity.name}: request failed`);
    }
    return false;
  }

  private showError(message: string): void {
    this.errorText = message;
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => (this.errorText = null), 5000);
  }

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
      this.store = { ...this.store, [state.id]: { ...this.store[state.id], ...state } };
      ENTITIES.feedTimes.forEach((meal, idx) => {
        if (entityId(meal) === state.id) this.syncMealTime(idx, meal);
      });
    });
    eventSource.addEventListener("ping", (e: Event) => {
      const event = e as MessageEvent<string>;
      try {
        const { title, uptime }: { title?: string; uptime?: number } = JSON.parse(event.data);
        if (typeof title === "string") this.deviceTitle = title;
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

  private syncMealTime(idx: number, meal: Entity): void {
    const value = this.str(meal);
    if (this.editingMealTime[idx] || value === undefined) return;
    const next = [...this.mealTimes];
    next[idx] = value.slice(0, 5); // HH:MM:SS to HH:MM for <input type=time>
    this.mealTimes = next;
  }

  private minGapMinutes(): number {
    const arrival = this.num(ENTITIES.arrivalTimeout);
    const minFeed = this.num(ENTITIES.minimumFeedingTime);
    return (Number.isFinite(arrival) ? arrival : 0) + (Number.isFinite(minFeed) ? minFeed : 0);
  }

  private validateMealTimes(idx: number, candidate: string): string | null {
    const times = [...this.mealTimes];
    times[idx] = candidate;
    const minutes: number[] = [];
    for (const t of times) {
      const m = parseTimeToMinutes(t);
      if (m === null) return null;
      minutes.push(m);
    }
    const gap = this.minGapMinutes();
    for (let i = 1; i < minutes.length; i++) {
      const delta = (minutes[i] ?? 0) - (minutes[i - 1] ?? 0);
      if (delta <= 0) return "Meal times must be set in order.";
      if (delta < gap) return `Meals must be at least ${gap} min apart (arrival timeout + minimum feeding time).`;
    }
    return null;
  }

  toggleSettingsHelp(): void {
    this.showSettingsHelp = !this.showSettingsHelp;
  }

  pressButton(entity: Entity): void {
    void this.post(entity, "press");
  }

  // Lit only re-sets .checked when the rendered value changes, so undo a rejected toggle by hand
  async setSwitch(entity: Entity, e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const ok = await this.post(entity, input.checked ? "turn_on" : "turn_off");
    if (!ok) input.checked = this.isOn(entity);
  }

  stepNumberEntity(entity: Entity, direction: 1 | -1): void {
    const cur = this.entityState(entity);
    const curVal = this.num(entity);
    if (!Number.isFinite(curVal)) return;
    const step = this.stepOf(entity);
    const min = cur?.min_value !== undefined ? Number(cur.min_value) : -Infinity;
    const max = cur?.max_value !== undefined ? Number(cur.max_value) : Infinity;
    const next = Math.min(max, Math.max(min, curVal + direction * step));
    void this.post(entity, "set", "value=" + next.toFixed(decimalsOf(step)));
  }

  onMealTimeFocus(idx: number): void {
    this.editingMealTime[idx] = true;
  }

  onMealTimeBlur(idx: number, e: Event): void {
    (e.target as HTMLInputElement).setCustomValidity("");
    this.endMealEdit(idx);
  }

  async onMealTimeChange(idx: number, e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const meal = ENTITIES.feedTimes[idx];
    if (!meal || !input.value) {
      this.endMealEdit(idx, input);
      return;
    }
    const error = this.validateMealTimes(idx, input.value);
    if (error) {
      this.endMealEdit(idx, input);
      input.setCustomValidity(error);
      input.reportValidity();
      return;
    }
    input.setCustomValidity("");
    const ok = await this.post(meal, "set", "value=" + encodeURIComponent(input.value + ":00"));
    if (!ok) {
      this.endMealEdit(idx, input);
    } else if (document.activeElement !== input) {
      this.endMealEdit(idx);
    }
  }

  isEditingMealTime(idx: number): boolean {
    return this.editingMealTime[idx] === true;
  }

  private endMealEdit(idx: number, revertInput?: HTMLInputElement): void {
    this.editingMealTime[idx] = false;
    const meal = ENTITIES.feedTimes[idx];
    if (meal) this.syncMealTime(idx, meal);
    if (revertInput) {
      revertInput.setCustomValidity("");
      this.requestUpdate();
    }
  }
}

customElements.define("esp-app", PlaRemote);
