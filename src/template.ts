import temperatureIcon from "@material-symbols/svg-400/outlined/ac_unit.svg";
import coolingIcon from "@material-symbols/svg-400/outlined/air.svg";
import ledModeIcon from "@material-symbols/svg-400/outlined/backlight_high.svg";
import batteryChargingIcon from "@material-symbols/svg-400/outlined/battery_charging_full.svg";
import batteryIcon from "@material-symbols/svg-400/outlined/battery_full.svg";
import feedingTimeIcon from "@material-symbols/svg-400/outlined/cookie.svg";
import lidIcon from "@material-symbols/svg-400/outlined/earbud_case.svg";
import errorIcon from "@material-symbols/svg-400/outlined/error.svg";
import helpIcon from "@material-symbols/svg-400/outlined/help.svg";
import targetIcon from "@material-symbols/svg-400/outlined/nest_farsight_cool.svg";
import chimeIntervalIcon from "@material-symbols/svg-400/outlined/notification_settings.svg";
import chimeIcon from "@material-symbols/svg-400/outlined/notifications.svg";
import powerOffIcon from "@material-symbols/svg-400/outlined/power_off.svg";
import arrivalTimeoutIcon from "@material-symbols/svg-400/outlined/timelapse.svg";
import { html, noChange, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import plateSvg from "../assets/plate.svg";
import type { PlaRemote } from "./app";
import { ENTITIES, type Entity } from "./entities";

type PerMeal<T, Meals = typeof ENTITIES.feedTimes> = { readonly [K in keyof Meals]: T };
const MEAL_CHIPS: PerMeal<string> = ["bg-meal-1", "bg-meal-2", "bg-meal-3"];
const MEAL_COLORS: PerMeal<string> = ["var(--color-meal-1)", "var(--color-meal-2)", "var(--color-meal-3)"];

const NEXT_MEAL_COLOR = "#D6B798"; // the original plate highlight, kept for Next Feeding

function plate(colorOf: (i: number) => string | null): TemplateResult {
  const vars = ENTITIES.feedTimes.map((_, i) => {
    const color = colorOf(i);
    return color ? `--plate-fill-${i + 1}:${color};--plate-digit-${i + 1}:#fff;` : "";
  }).join("");
  return html`<div class="w-23 h-24.5 shrink-0 [&>svg]:h-full [&>svg]:w-full" style=${vars} aria-hidden="true">
    ${unsafeHTML(plateSvg)}
  </div>`;
}
function msIcon(raw: string, sizeAndColor = "w-4.5 h-4.5 text-text-muted"): TemplateResult {
  return html`<span class="inline-block shrink-0 [&>svg]:h-full [&>svg]:w-full [&>svg]:fill-current ${sizeAndColor}"
    >${unsafeHTML(raw)}</span
  >`;
}

const BANNER_TONES = {
  danger: { box: "bg-danger-soft", badge: "bg-danger/15 text-danger", title: "text-danger" },
  warn: { box: "bg-accent-soft", badge: "bg-accent/20 text-accent-dark", title: "text-accent-dark" },
} as const;

function banner(hidden: boolean, tone: keyof typeof BANNER_TONES, icon: string, title: string, detail: string): TemplateResult {
  const t = BANNER_TONES[tone];
  return html`<div class="flex items-center gap-3 rounded-lg px-3.5 py-2 mb-3.5 ${t.box}" ?hidden=${hidden}>
    <span class="w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${t.badge}">${msIcon(icon, "w-5 h-5")}</span>
    <div class="flex flex-col gap-0.5 min-w-0">
      <div class="text-[14px] font-bold ${t.title}">${title}</div>
      <div class="text-xs text-text-muted">${detail}</div>
    </div>
  </div>`;
}

function settingRow(remote: PlaRemote, icon: string, label: string, help: string, control: TemplateResult): TemplateResult {
  return html`<div class="row flex-col items-stretch">
    <div class="flex items-center justify-between gap-2">
      <div class="row-label min-w-0"><span class="badge">${msIcon(icon)}</span>${label}</div>
      ${control}
    </div>
    <p class="m-0 mt-2 text-xs leading-snug text-text-muted" ?hidden=${!remote.showSettingsHelp}>${help}</p>
  </div>`;
}

function switchToggle(checked: boolean, onChange: (e: Event) => void): TemplateResult {
  return html`
    <label class="relative w-11 h-6.5 shrink-0 inline-block">
      <input
        type="checkbox"
        class="peer absolute inset-0 opacity-0 w-full h-full m-0 z-10 cursor-pointer"
        .checked=${checked}
        @change=${onChange}
      />
      <span
        class="absolute inset-0 bg-switch-track-off rounded-full transition-colors duration-150 peer-checked:bg-accent"
      ></span>
      <span
        class="absolute top-0.75 left-0.75 w-5 h-5 bg-white rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-150 peer-checked:translate-x-4.5"
      ></span>
    </label>
  `;
}

function numberStepper(remote: PlaRemote, entity: Entity, suffix: string, zeroText?: string): TemplateResult {
  const stepBtn = "w-7.5 h-7.5 rounded-full border-0 bg-tray text-accent-dark text-base font-extrabold cursor-pointer active:scale-90";
  return html`
    <div class="flex items-center gap-2.5">
      <button class="${stepBtn}" @click=${() => remote.stepNumberEntity(entity, -1)}>−</button>
      <span class="min-w-11 text-center font-extrabold text-[15px]">${remote.numText(entity, suffix, zeroText)}</span>
      <button class="${stepBtn}" @click=${() => remote.stepNumberEntity(entity, 1)}>+</button>
    </div>
  `;
}

export function renderTemplate(remote: PlaRemote): TemplateResult {
  const nextMeal = remote.nextMeal;
  return html`
    <div class="flex items-center justify-between pt-[calc(16px+env(safe-area-inset-top))] px-1 pb-3">
      <div>
        <h1 class="text-[19px] max-[385px]:text-base font-bold m-0 tracking-[0.2px]">${remote.deviceTitle}</h1>
        <div class="text-xs text-text-muted mt-0.5 flex items-center gap-1">
          <span class="w-2 h-2 rounded-full shrink-0 ${remote.connected ? "bg-ok" : "bg-danger"}"></span>
          <span>${remote.connLabel}</span>
        </div>
      </div>
      <div class="flex items-center gap-0.5 bg-card rounded-full px-2 py-1.5 shadow text-xs font-semibold text-text">
        ${msIcon(
    remote.isOn(ENTITIES.acPower) ? batteryChargingIcon : batteryIcon,
    `w-3.5 h-3.5 ${remote.batteryLow ? "text-danger" : "text-text-muted"}`,
  )}
        <span class="leading-none">${remote.batteryPctText}</span>
      </div>
    </div>

    ${banner(
      !remote.isOn(ENTITIES.missedMeal),
      "danger",
      errorIcon,
      "Pet missed a meal",
      "Today's meals may be offset unless fed manually.",
    )}
    ${banner(!remote.onBattery, "warn", powerOffIcon, "Running on battery", "Cooling is paused until AC power returns.")}

    <div
      class="fixed inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md flex items-center gap-3 bg-danger-soft text-danger rounded-md px-3.5 py-2.5 text-[13px] font-semibold shadow transition-[opacity,translate] duration-200 starting:opacity-0 starting:translate-y-2"
      role="alert"
      ?hidden=${!remote.errorText}
    >
      ${msIcon(errorIcon, "w-5 h-5")}
      <span>${remote.errorText}</span>
    </div>

    <div class="card">
      <div class="card-title">
        <h2>Next Feeding</h2>
        <div class="flex gap-2">
          <button
            class="flex-none h-8 px-3 gap-1.5 rounded-full border-0 bg-accent-soft text-accent-dark text-[13px] font-bold flex items-center justify-center cursor-pointer active:scale-90"
            title="Toggle lid"
            @click=${() => remote.pressButton(ENTITIES.doorToggle)}
          >
            ${msIcon(lidIcon, "w-4.5 h-4.5")}
            Lid
          </button>
          <button
            class="flex-none w-8 h-8 rounded-full border-0 bg-accent-soft text-accent-dark flex items-center justify-center cursor-pointer active:scale-90"
            aria-label="Play chime"
            title="Play chime"
            @click=${() => remote.pressButton(ENTITIES.chime)}
          >
            ${msIcon(chimeIcon, "w-4.5 h-4.5")}
          </button>
        </div>
      </div>
      <div class="flex items-center gap-4.5">
        ${plate((i) => (i === nextMeal.index ? NEXT_MEAL_COLOR : null))}
        <div class="flex-1 min-w-0">
          <div class="stat-label">Next slot</div>
          <div class="text-[28px] font-extrabold leading-tight">${nextMeal.timeText}</div>
          <div class="text-xs text-text-muted" ?hidden=${!nextMeal.label}>${nextMeal.label}</div>
        </div>
      </div>
      <div class="flex gap-2.5 mt-4">
        <button class="btn bg-accent text-white" @click=${() => remote.pressButton(ENTITIES.feedNow)}>
          ${msIcon(chimeIcon, "w-4.5 h-4.5")}
          Feed Now
        </button>
        <button class="btn" @click=${() => remote.pressButton(ENTITIES.rotatePlate)}>Rotate Plate</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <h2>Feeding Schedule</h2>
        ${switchToggle(remote.isOn(ENTITIES.schedule), (e) => remote.setSwitch(ENTITIES.schedule, e))}
      </div>
      <div class="flex items-center gap-4.5">
        ${plate((i) => MEAL_COLORS[i] ?? null)}
        <div class="@container flex flex-col gap-2 flex-1 min-w-0">
          ${ENTITIES.feedTimes.map(
            (meal, i) => html`
              <label class="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 text-bg ${MEAL_CHIPS[i] ?? MEAL_CHIPS[0]}">
                <span
                  class="h-6 min-w-6 @min-[190px]:w-19 px-1.5 shrink-0 rounded-full bg-black/15 flex items-center justify-center text-xs font-extrabold"
                  ><span class="hidden @min-[190px]:inline">${meal.name}</span><span class="@min-[190px]:hidden">${i + 1}</span></span
                >
                <input
                  type="time"
                  aria-label=${meal.name}
                  class="time-input flex-1 min-w-0 border-0 bg-transparent p-0 text-sm font-bold text-inherit font-[inherit] disabled:opacity-40"
                  .value=${remote.isEditingMealTime(i) ? noChange : live(remote.mealTimes[i] ?? "")}
                  @focus=${() => remote.onMealTimeFocus(i)}
                  @blur=${(e: Event) => remote.onMealTimeBlur(i, e)}
                  @change=${(e: Event) => remote.onMealTimeChange(i, e)}
                />
              </label>
            `,
          )}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <h2>Pet Presence</h2>
        <span class="text-xs font-semibold ${remote.isOn(ENTITIES.presence) ? "text-ok" : "text-text-muted"}">${remote.presenceText}</span>
      </div>
      <div class="@container">
        <div class="flex flex-col @min-[380px]:flex-row @min-[380px]:items-center">
          <div class="flex items-center gap-4.5 flex-1 min-w-0">
            <div
              class="pet-body w-23 h-19 shrink-0 bg-current transition-colors duration-150 ${remote.isOn(ENTITIES.presence)
      ? "text-accent-dark"
      : "text-text-muted"}"
            ></div>
            <div class="flex-1 min-w-0">
              <div class="stat-label">Last visit</div>
              <div class="text-[28px] font-extrabold leading-tight">${remote.lastVisitDurationText}</div>
              <div class="text-xs text-text-muted" ?hidden=${!remote.lastVisitAtText}>at ${remote.lastVisitAtText}</div>
            </div>
          </div>
          <div
            class="flex items-stretch text-center mt-4 pt-3.5 border-t border-tray @min-[380px]:mt-0 @min-[380px]:pt-0 @min-[380px]:border-t-0 @min-[380px]:self-stretch @min-[380px]:py-2"
          >
            <div class="flex-1 flex flex-col justify-center @min-[380px]:flex-none @min-[380px]:px-3.5">
              <div class="stat-label">Visits</div>
              <div class="text-lg font-extrabold leading-tight mt-0.5">${remote.stateText(ENTITIES.visitCount)}</div>
            </div>
            <div class="w-px bg-tray"></div>
            <div class="flex-1 flex flex-col justify-center @min-[380px]:flex-none @min-[380px]:pl-3.5">
              <div class="stat-label">Total time</div>
              <div class="text-lg font-extrabold leading-tight mt-0.5">${remote.totalVisitText}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><h2>Chamber</h2></div>
      <div class="row">
        <div class="row-label">
          <span class="badge">${msIcon(temperatureIcon)}</span>
          Temperature
        </div>
        <span class="text-text text-lg font-extrabold">${remote.stateText(ENTITIES.chamberTemp, "-- °F")}</span>
      </div>
      <div class="row">
        <div class="row-label"><span class="badge">${msIcon(coolingIcon)}</span>Cooling</div>
        ${switchToggle(remote.isOn(ENTITIES.cooling), (e) => remote.setSwitch(ENTITIES.cooling, e))}
      </div>
      <div class="row">
        <div class="row-label"><span class="badge">${msIcon(targetIcon)}</span>Target</div>
        ${numberStepper(remote, ENTITIES.coolingTarget, "°")}
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <h2>Configuration</h2>
        <button
          class="w-8 h-8 shrink-0 rounded-full border-0 flex items-center justify-center cursor-pointer active:scale-90 ${remote.showSettingsHelp
            ? "bg-accent-soft text-accent-dark"
            : "bg-transparent text-text-muted"}"
          aria-label="Help"
          aria-expanded=${String(remote.showSettingsHelp)}
          @click=${() => remote.toggleSettingsHelp()}
        >
          ${msIcon(helpIcon, "w-5 h-5")}
        </button>
      </div>
      ${settingRow(
        remote,
        arrivalTimeoutIcon,
        "Arrival Timeout",
        "How long to wait for your pet once a meal is served. If they don't show up, the lid will close, and the plate won't rotate.",
        numberStepper(remote, ENTITIES.arrivalTimeout, " min"),
      )}
      ${settingRow(
        remote,
        feedingTimeIcon,
        "Feeding Time",
        "Once your pet arrives, how long to keep the lid open.",
        numberStepper(remote, ENTITIES.minimumFeedingTime, " min"),
      )}
      ${settingRow(
        remote,
        chimeIntervalIcon,
        "Chime Interval",
        "While waiting for your pet, chime again every this many seconds until they arrive. Turn off to chime only once per meal.",
        numberStepper(remote, ENTITIES.chimeInterval, " s", "Off"),
      )}
      ${settingRow(
        remote,
        ledModeIcon,
        "Status LED",
        "Enable to show a steady white light while everything is fine. Warnings show regardless: red pulse for a missed meal and pulsing white when Wi-Fi is down.",
        switchToggle(remote.isOn(ENTITIES.statusLed), (e) => remote.setSwitch(ENTITIES.statusLed, e)),
      )}
    </div>

    <div class="text-center">
      <a
        class="text-xs text-text-muted underline underline-offset-2"
        href="https://github.com/esphome/esphome/releases"
        target="_blank"
        rel="noopener"
        >${remote.firmwareVersionText}</a
      >
    </div>
  `;
}
