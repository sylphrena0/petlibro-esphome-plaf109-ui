export type Domain = "switch" | "sensor" | "binary_sensor" | "text_sensor" | "number" | "button" | "time";

export interface Entity {
  readonly domain: Domain;
  readonly name: string;
}

/**
 * web_server's entity id, as used in SSE state events and REST paths: "<domain>/<name>"
 */
export function entityId(entity: Entity): string {
  return entity.domain + "/" + entity.name;
}

export const ENTITIES = {
  schedule: { domain: "switch", name: "Feeding Schedule" },
  cooling: { domain: "switch", name: "Cooling Enabled" },
  presence: { domain: "binary_sensor", name: "Pet Present" },
  missedMeal: { domain: "binary_sensor", name: "Missed Meal" },
  acPower: { domain: "binary_sensor", name: "AC Power Present" },
  battery: { domain: "sensor", name: "Battery Percentage" },
  chamberTemp: { domain: "sensor", name: "Chamber Temperature" },
  coolingTarget: { domain: "number", name: "Food Cooling Target" },
  arrivalTimeout: { domain: "number", name: "Arrival Timeout" },
  minimumFeedingTime: { domain: "number", name: "Eating Time" },
  chimeInterval: { domain: "number", name: "Chime Interval" },
  feedTimes: [
    { domain: "time", name: "Meal One" },
    { domain: "time", name: "Meal Two" },
    { domain: "time", name: "Meal Three" },
  ],
  feedNow: { domain: "button", name: "Feed Now" },
  rotatePlate: { domain: "button", name: "Rotate Plate" },
  doorToggle: { domain: "button", name: "Toggle Lid" },
  chime: { domain: "button", name: "Play Chime" },
  visitCount: { domain: "sensor", name: "Pet Visit Count" },
  lastVisitTime: { domain: "text_sensor", name: "Last Visit" },
  lastVisitDuration: { domain: "sensor", name: "Last Visit Duration" },
  totalVisitTime: { domain: "sensor", name: "Total Time At Feeder" },
  statusLed: { domain: "switch", name: "Status LED" },
  firmwareVersion: { domain: "text_sensor", name: "Firmware Version" },
} as const satisfies Record<string, Entity | readonly Entity[]>;
