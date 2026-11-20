import { shared, setShared } from "herdr";
import { getDemoData, DEMO_KEY, DEMO_TABS_KEY } from "./demo.js";

export const isDemo = () => shared(DEMO_KEY) === true;
export const dashboardNow = () => new Date();

export function setDemo(enabled) {
  // Publish only the fixtures used by the other mod folders.
  if (enabled) {
    const demo = getDemoData();
    setShared(DEMO_TABS_KEY, demo.spacesList.find((space) => space.active)?.tabs ?? []);
    setShared("herdr-control.demoPhrases", demo.phrases);
  }
  setShared(DEMO_KEY, enabled);
  if (!enabled) {
    setShared(DEMO_TABS_KEY, null);
    setShared("herdr-control.demoPhrases", null);
  }
}
