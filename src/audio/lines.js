// src/audio/lines.js
// The voice callouts: one short line each, rendered once to assets/voice/<id>.mp3 by
// tools/make_voice.py (open Kokoro-82M text-to-speech model). The text is also the fallback for
// the browser speech synthesis when a file is missing.

export const VOICE_LINES = {
  online: 'Systems online.',
  // Capture levels (1 to 4)
  range5: 'Five meters.',
  range3: 'Three meters.',
  range2: 'Two meters.',
  window: 'Capture window open.',
  tooFast: 'Closing too fast. Brake.',
  tooClose: 'Too close. Back off.',
  plume: 'Plume on the client.',
  matchSpin: "Match the client's spin.",
  noGo: 'No go.',
  probe: 'Extending the probe.',
  softCapture: 'Soft capture.',
  docked: 'Hard capture. Docked.',
  despin: 'Stopping the spin.',
  t30: 'Thirty seconds.',
  t10: 'Ten seconds.',
  fuelLow: 'Propellant running low.',
  contact: 'Contact. Abort.',
  missed: 'Missed the nozzle.',
  timeUp: 'Time is up.',
  driftAway: 'Drifting away. Abort.',
  budgetOut: 'Propellant budget used up.',
  failed: 'Attempt failed.',
  // Level 5 Connect
  overValve: 'Over the valve.',
  capOff: 'Cap removed.',
  mated: 'Tool connected.',
  collision: 'Collision. Abort.',
  strike: 'Hard contact. Abort.',
  // Level 6 Transfer
  leakCheck: 'Leak check running.',
  leakPass: 'Leak check passed.',
  leakFail: 'Leak detected.',
  lineOpen: 'Line open.',
  flowOn: 'Flow started.',
  flowOff: 'Flow stopped.',
  nearGoal: 'Ten kilograms to go.',
  inBand: 'In the band. Stop the flow.',
  pressureHigh: 'Tank pressure high.',
  overfill: 'Overfill. Abort.',
  overpressure: 'Overpressure. Abort.',
  transferDone: 'Transfer complete.',
  // Level 7 Depart
  undocking: 'Releasing the client.',
  separated: 'Separated. Plan the burn.',
  safe: 'Trajectory safe.',
  unsafe: 'Unsafe. Burn refused.',
  overBudget: 'Over budget. Burn refused.',
  burnDone: 'Burn complete.',
  departed: 'Clear of the client.'
};

// Priorities: an info line waits its turn and is dropped when it gets stale, a warning goes
// before info lines, a critical line cuts in.
export const PRIORITY = { info: 0, warning: 1, critical: 2 };
