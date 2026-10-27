import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const coreSource = await readFile(new URL("../src/presence-monitor.js", import.meta.url), "utf8");
const sandbox = { console };
vm.runInNewContext(coreSource, sandbox, { filename: "presence-monitor.js" });
const api = sandbox.SlackPresenceMonitor;

class FakeElement {
  constructor({ textNodes = [], attributes = {}, parentElement = null } = {}) {
    this.textNodes = textNodes;
    this.attributes = attributes;
    this.parentElement = parentElement;
    this.children = [];
    if (parentElement) parentElement.children.push(this);
    this.ownerDocument = null;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  querySelectorAll(selector) {
    if (selector !== api.DEFAULT_INDICATOR_SELECTOR) return [];
    const ownIndicator = this.attributes["data-qa"] === "presence_indicator" ? [this] : [];
    return ownIndicator.concat(this.children.flatMap((child) => child.querySelectorAll(selector)));
  }
}

class FakeDocument {
  constructor(indicators = []) {
    this.indicators = indicators;
    this.defaultView = { NodeFilter: { SHOW_TEXT: 4 } };
    for (const indicator of indicators) {
      let current = indicator;
      while (current) {
        current.ownerDocument = this;
        current = current.parentElement;
      }
    }
  }

  querySelectorAll(selector) {
    return selector === api.DEFAULT_INDICATOR_SELECTOR ? this.indicators : [];
  }

  createTreeWalker(element) {
    let index = 0;
    return {
      nextNode() {
        const text = element.textNodes[index];
        index += 1;
        return text === undefined ? null : { textContent: text };
      }
    };
  }
}

function makeIndicator(name, active) {
  const row = new FakeElement({ textNodes: [name] });
  const indicator = new FakeElement({
    attributes: {
      "data-qa": "presence_indicator",
      "data-qa-presence-self": "false",
      "data-qa-presence-active": String(active)
    },
    parentElement: row
  });
  return { row, indicator };
}

function createHarness(indicators, targetName = "Demo User") {
  const documentRef = new FakeDocument(indicators);
  const notifications = [];
  const events = [];
  const monitor = api.createPresenceMonitor({
    documentRef,
    targetName,
    notify: (message) => notifications.push(message),
    onEvent: (event) => events.push(event),
    logger: { log() {}, warn() {}, error() {} },
    clock: { setInterval() { return 1; }, clearInterval() {} }
  });
  return { documentRef, notifications, events, monitor };
}

test("detects the initial state and does not notify for an unchanged state", () => {
  const { indicator } = makeIndicator("Demo User", true);
  const harness = createHarness([indicator]);

  assert.deepEqual(harness.monitor.check().status, "active");
  harness.monitor.check();

  assert.deepEqual(harness.notifications, ["Monitoring started. Current status: active."]);
  assert.equal(harness.events.filter((event) => event.type === "status-changed").length, 0);
});

test("detects Active to Away and Away to Active transitions", () => {
  const first = makeIndicator("Demo User", true);
  const harness = createHarness([first.indicator]);
  harness.monitor.check();

  first.indicator.attributes["data-qa-presence-active"] = "false";
  harness.monitor.check();
  first.indicator.attributes["data-qa-presence-active"] = "true";
  harness.monitor.check();

  assert.deepEqual(harness.notifications, [
    "Monitoring started. Current status: active.",
    "The configured user is now AWAY.",
    "The configured user is now ACTIVE."
  ]);
});

test("reports a missing target without sending a status notification", () => {
  const other = makeIndicator("Other User", true);
  const harness = createHarness([other.indicator]);

  assert.equal(harness.monitor.check().status, "missing");
  assert.deepEqual(harness.notifications, []);
  assert.equal(harness.events[0].type, "target-missing");
});

test("does not notify when matching indicators disagree", () => {
  const active = makeIndicator("Demo User", true);
  const away = makeIndicator("Demo User", false);
  const harness = createHarness([active.indicator, away.indicator]);

  assert.equal(harness.monitor.check().status, "inconsistent");
  assert.deepEqual(harness.notifications, []);
  assert.equal(harness.events[0].type, "inconsistent-indicators");
});

test("rejects missing or placeholder configuration", () => {
  const errors = api.validateConfiguration({
    targetName: "CHANGE_ME",
    intervalMs: 3000,
    notify: () => {}
  });

  assert.equal(errors.length, 1);
  assert.equal(
    api.validateConfiguration({ targetName: "Demo User", intervalMs: 50, notify: () => {} }).length,
    1
  );
  assert.equal(
    api.validateConfiguration({ targetName: "Demo User", intervalMs: 3000 }).length,
    1
  );
  assert.throws(
    () => api.createPresenceMonitor({ targetName: "", intervalMs: 3000, notify: () => {}, documentRef: new FakeDocument() }),
    /Invalid monitor configuration/
  );
});
