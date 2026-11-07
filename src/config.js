// src/config.js
// All tunable numbers are in SI units unless a comment says otherwise.
// Physics and rules modules must not import three.js or touch the DOM.

export const MU = 3.986004418e14; // m^3/s^2
export const R_E = 6378137; // m
export const G0 = 9.80665; // m/s^2
export const EARTH_SPIN_RATE = 7.2921159e-5; // rad/s
export const SUN_ANGULAR_RADIUS_RAD = 0.2665 * Math.PI / 180; // rad
export const EARTH_ALBEDO = 0.30; // dimensionless
export const DEG_TO_RAD = Math.PI / 180; // rad/deg
export const RAD_TO_DEG = 180 / Math.PI; // deg/rad

function makeOrbit(name, altitudeM, inclinationDeg, defaultBetaDeg, u0Rad, subSatelliteLongitudeRad) {
  const aM = R_E + altitudeM;
  const nRadPerS = Math.sqrt(MU / (aM * aM * aM));
  const periodS = 2 * Math.PI / nRadPerS;
  return {
    name,
    altitudeM,
    aM,
    inclinationDeg,
    inclinationRad: inclinationDeg * DEG_TO_RAD,
    nRadPerS,
    periodS,
    defaultBetaDeg,
    defaultBetaRad: defaultBetaDeg * DEG_TO_RAD,
    u0Rad,
    subSatelliteLongitudeRad
  };
}

export const ORBITS = {
  GEO: makeOrbit('GEO graveyard', 35786000 + 290000, 0, -9.26, 0, -19.0 * DEG_TO_RAD),
  LEO: makeOrbit('LEO 500 km', 500000, 51.6, 15.0, 0, 0)
};

export const START_ATTITUDE = { w: 0, x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 };

export const PHYSICS = {
  rk4MaxStepS: 0.5, // s
  closeProximityRangeM: 30, // m
  closeProximityMaxStepS: 0.05 // s
};

export const CHASER = {
  dryMassKg: 1600, // kg
  ownPropellantKg: 150, // kg
  cargoPropellantKg: 300, // kg
  busMassKg: 1960, // kg, bus with propellant but excluding wings
  busDimensionsM: [2.5, 2.0, 2.0], // m, body X, Y, Z
  wingMassKg: 45, // kg each
  wingRootM: 1.0, // m from body centre along body Y
  wingTipM: 9.5, // m from body centre along body Y
  wingAxis: 'Y',
  inertiaKgM2: [4300, 1700, 4700], // kg m^2, body X, Y, Z
  rcsThrusterForceN: 22, // N
  rcsThrustersPerDirection: 2,
  rcsTranslationForceN: 44, // N, 2 x 22 N
  rcsRotationArmM: 1.0, // m
  rcsRotationTorqueNm: 44, // N m, couple of 2 x 22 N on 1 m arm
  ispS: 220, // s
  dockingFaceAheadOfCmM: 1.25, // m
  translationPulseMps: 0.01, // m/s per key press
  rotationStepDegPerPress: 0.05, // deg/s per key press in realistic mode
  arcadeRotationRateDegPerS: 5.0, // deg/s continuous in arcade mode, assumption
  attitudeHoldKpWnRadPerS: 0.4, // rad/s, natural frequency
  attitudeHoldZeta: 1.0, // dimensionless
  attitudeHoldMinPulseS: 0.01, // s
  attitudeHoldMinPulseFrac: 0.05 // dimensionless
};

export const CLIENT = {
  // Fictional retired communications satellite (see ASSUMPTIONS.md, mass and inertia).
  dryMassKg: 2090, // kg
  launchMassKg: 4950, // kg
  dockingMassKg: 2120, // kg, dry + 30 kg transfer-tank propellant
  transferPropellantKg: 30, // kg
  busMassKg: 1830, // kg, inertia model bus, propellant included
  busDimensionsM: [3.5, 2.8, 2.8], // m along LVLH x, y, z
  wingMassKg: 120, // kg each
  wingRootM: 1.4, // m from centre along LVLH z
  wingTipM: 15.45, // m from centre along LVLH z
  wingWidthM: 2.5, // m
  wingAxis: 'Z',
  reflectorMassesKg: [32, 18], // kg, the large and the small reflector
  reflectorPositionsM: [
    { x: -1.15, y: 2.4, z: 0.3 }, // m in LVLH
    { x: -0.55, y: -2.15, z: -0.4 } // m in LVLH
  ],
  inertiaKgM2: [23600, 24200, 3500], // kg m^2, LVLH x, y, z
  solarSpanM: 30.9, // m tip to tip
  overallLengthM: 4.8, // m along LVLH x
  busAcrossM: 2.8, // m
  activeAttitudeControlUntilHardCapture: true
};

// The three fictional clients, one per scenario, share the docking interface, the mass at docking
// and the tank; their shape and inertia differ (mass models in ASSUMPTIONS.md, Clients). Inertia
// about the client CM in LVLH axes (x along the engine axis).
export const CLIENT_MODELS = {
  relay: { name: 'retired relay satellite', inertiaKgM2: [23600, 24200, 3500], spanM: 30.9 }, // kg m^2, m
  observer: { name: 'Earth observation satellite', inertiaKgM2: [4700, 5900, 2900], spanM: 10.8 }, // kg m^2, m
  // The engine axis is the major axis (15,200 > 14,000 > 5,300): a spin about it is stable.
  derelict: { name: 'communications satellite without attitude control', inertiaKgM2: [15200, 14000, 5300], spanM: 22.7 } // kg m^2, m
};

export const CAPTURE = {
  laeEngineLengthM: 0.55, // m
  laeExitDiameterM: 0.28, // m
  laeThroatDiameterM: 0.022, // m
  laeBellLengthM: 0.40, // m
  ringDiameterM: 1.194, // m
  ringRadiusM: 0.597, // m
  nozzleExitProtrusionM: 0.34, // m beyond ring plane
  probeTipFoldedDiameterM: 0.018, // m
  probeTipOpenDiameterM: 0.04, // m
  extensionStopPastThroatM: 0.04, // m
  strokeOffsetM: 0.10, // m, stroke = d + 0.10 m
  maxStrokeM: 1.30, // m
  extensionRateMps: 0.22, // m/s
  stanchionCount: 3,
  stanchionLengthM: 0.50, // m
  stanchionTipRadiusM: 0.597, // m
  stanchionSpacingDeg: 120, // deg
  retractionDistanceM: 0.50, // m
  retractionTimeS: 10, // s
  softSeatSpeedMps: 0.01, // m/s
  softSeatDistanceM: 0.05, // m
  finalExtensionM: 0.60, // m
  nozzleExitClearanceM: 0.16, // m
  undockPushSpeedMps: 0.02, // m/s
  ringPlaneAboveClientCmM: 1.80, // m
  zenithDeckAboveClientCmM: 1.75, // m
  dockingFaceAheadChaserCmM: 1.25, // m
  axisOffsetM: 3.05, // m, CM-to-CM x = d + 3.05 m
  captureCmXM: 4.05, // m, at d = 1.0 m
  dockedCmXM: 3.55, // m, final docked CM separation
  captureDm: 1.0, // m
  captureDToleranceM: 0.15, // m
  lateralToleranceM: 0.10, // m
  pitchYawToleranceDeg: 4.0, // deg
  rollToleranceDeg: 4.0, // deg
  pitchYawRateToleranceDegS: 0.20, // deg/s
  rollRateToleranceDegS: 0.20, // deg/s
  relativeSpeedToleranceMps: 0.02, // m/s
  readyHoldS: 10, // s
  extensionTimeS: 5, // s
  fingerExpandTimeS: 1, // s
  hardCaptureRetractionS: 10, // s
  latchTimeS: 5 // s, latches close after hard capture, then the stack is docked
};

export const ARM = {
  // Service valve on the client aft face, between two stanchions.
  valveOffsetFromLaeAxisM: 0.85, // m
  valveBracketHeightM: 0.10, // m, valve face above the aft face
  valveAzimuthDeg: 60, // deg, halfway between stanchions at 0/120/240 deg
  valveRadiusM: 0.055, // m, valve body
  valveBootRadiusM: 0.08, // m, boot at the foot of the valve
  valveBootHeightM: 0.03, // m
  capRadiusM: 0.065, // m
  capHeightM: 0.03, // m, the cap sits on the valve face
  valveCapRemovalTimeS: 10, // s, full mission
  unfoldAndMateTimeS: 60, // s, full mission
  purgeTimeS: 10, // s, full mission
  disconnectTimeS: 10, // s, full mission
  // Refuelling arm: a SCARA arm on the docking plate. Shoulder and elbow turn about axes parallel
  // to the docking axis, so the two links sweep planes parallel to the docking face; a vertical
  // stroke at the end of the second link lowers the tool along the valve axis.
  armBaseOffsetM: 0.30, // m from the probe axis, on the docking plate
  armBaseAzimuthDeg: 60, // deg, from body +Z towards body +Y (towards the valve)
  segment1M: 0.45, // m
  segment2M: 0.40, // m
  link1AheadOfFaceM: 0.10, // m, plane of the first link ahead of the docking face
  link2AheadOfFaceM: 0.17, // m, plane of the second link
  toolTipRetractedAheadOfFaceM: 0.22, // m, tool tip with the stroke retracted
  toolStrokeMaxM: 0.36, // m
  toolLengthM: 0.12, // m, tool body below the second link
  toolRadiusM: 0.035, // m, coupling
  linkRadiusM: 0.03, // m
  jointRateMaxDegS: 5, // deg/s, shoulder and elbow
  elbowMinDeg: 15, // deg, elbow angle limits (0 = stretched)
  elbowMaxDeg: 168, // deg
  stowShoulderDeg: 0, // deg, first link along the base azimuth
  stowElbowDeg: 165, // deg, second link folded back over the first
  toolSpeedMps: 0.04, // m/s, tool speed across the docking axis while an arrow key is held
  strokeSpeedMps: 0.03, // m/s, tool speed along the docking axis while W or S is held
  fineSpeedFactor: 0.2, // dimensionless, SHIFT held
  contactSpeedMaxMps: 0.01, // m/s, the tool must touch the cap or the valve below this
  capCentringM: 0.01, // m, SPACE removes the cap within this distance of the valve axis
  capRemovalS: 3, // s, unscrewing the cap (level 5)
  toolMatingToleranceM: 0.005, // m, within 5 mm of the valve axis
  toolMatingAngleDeg: 2.0, // deg, the SCARA keeps the tool parallel to the docking axis
  dockedRollOffsetMaxDeg: 3, // deg, roll left by the capture: moves the valve across the arm
  connectTimeS: 90, // s
  connectBudgetMps: 0.0, // m/s, the arm is electric: no RCS budget is spent
  transferTimeS: 120, // s
  transferBudgetMps: 0.0, // m/s
  transferTimeCompression: 30, // x, fixed for the line processes (leak check, transfer)
  transferOpeningRatePerS: 0.5, // 1/s, opening change while an arrow key is held
  departureTimeS: 120, // s, to plan and execute the separation burn
  departureBudgetMps: 0.20, // m/s
  undockPushSpeedMps: 0.02, // m/s, the probe pushes the vehicles apart
  undockS: 3, // s, the probe releases the client before the planning starts
  departureRangeM: 30, // m, the level ends when the range passes this
  departureFastForward: 100, // x, automatic after a SAFE burn (T and G change it)
  departureContactRangeM: 3.55, // m, CM to CM: closer than this the vehicles touch
  departureContactCheckS: 60 // s, the near-term check for contact after the burn
};

export const TANK = {
  clientVolumeM3: 0.30, // m^3
  clientInitialPropellantKg: 30, // kg
  clientInitialUllagePressurePa: 5e5, // Pa (5 bar)
  chaserCargoPressurePa: 24e5, // Pa (24 bar)
  maxExpectedOperatingPressurePa: 22e5, // Pa (22 bar)
  propellantDensityKgM3: 1000, // kg/m^3
  goalKg: 150, // kg
  goalToleranceFrac: 0.02, // dimensionless
  flowCoefficientKgPerSPa0_5: 5e-5, // kg/(s Pa^0.5), assumption
  linePressureDropPa: 50000, // Pa (0.5 bar), assumption
  heliumPressurePa: 15e5, // Pa (15 bar)
  leakHoldS: 30, // s
  leakMaxDropFrac: 0.01, // dimensionless
  leakProbabilityBase: 0.0, // dimensionless
  leakProbabilityPerRadMisalignment: 1.0, // 1/rad
  leakProbabilityPerMeterLateral: 0.5, // 1/m
  leakProbabilityMax: 0.5, // dimensionless
  valveOrder: ['chaserCargoIsolation', 'line', 'clientFill'],
  closeValveOrder: ['clientFill', 'line', 'chaserCargoIsolation']
};

export const RULES = {
  kosRadiusM: 200, // m
  corridorHalfAngleDeg: 10, // deg
  holdPointsDm: [250, 80, 20, 1.0], // m, d from docking face to ring plane
  holdToleranceM: 2.0, // m
  holdToleranceHp3M: 0.5, // m
  holdSpeedMps: 0.01, // m/s
  holdDurationS: 10, // s
  speedEnvelope: [
    { minRangeM: 1000, maxSpeedMps: 2.0 }, // m, m/s
    { minRangeM: 200, maxSpeedMps: 0.5 }, // m, m/s
    { minRangeM: 30, maxSpeedMps: 0.2 }, // m, m/s
    { minRangeM: 0, maxSpeedMps: 0.10 } // m, m/s
  ],
  envelopeViolationTimeS: 5, // s
  camImpulseMps: 0.5, // m/s
  camDirectionCount: 26,
  camFirstWindowS: 900, // s
  camMinRangeWindowOrbits: 2, // orbits
  camFallback: true,
  collisionSpeedMps: 0.3, // m/s
  departureRangeM: 30, // m
  departureSafeOrbits: 2, // orbits
  departureNoCloseApproachM: 5, // m
  departureFirst60s: 60 // s
};

export const TIME_WARP = {
  levels: [1, 2, 5, 10, 50, 100],
  geoLevels: [1, 2, 5, 10, 50, 100, 500, 2000],
  kosMax: 50, // inside the KOS while coasting (raised from 10x for playability)
  kosMinRangeM: 30, // m, below this range the warp stops at closeMax
  closeMax: 10, // within 30 m while coasting
  captureZoneRangeM: 4.5, // m, 1x below this range (d below 1.45 m)
  transferMax: 20
};

// Capture challenges: short skill levels on the last metres before capture, at 1x time.
// Positions and velocities are LVLH (CM to CM, client at the origin); d is the distance from
// the servicer docking face to the client ring plane. Each level lasts at most timeS.
export const CHALLENGE = {
  levels: [
    {
      id: 1, name: 'First capture', timeS: 100, budgetMps: 0.30,
      startDm: 5, offset: { y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      coneDeg: 0, conePeriodS: 0, impingement: false,
      brief: 'Close in along the docking axis, slow down, and capture when the window turns green.'
    },
    {
      id: 2, name: 'Off the axis', timeS: 110, budgetMps: 0.35,
      startDm: 7, offset: { y: 0.35, z: -0.25 }, velocity: { x: -0.03, y: 0.006, z: -0.004 },
      coneDeg: 0, conePeriodS: 0, impingement: false,
      brief: 'The last braking burn left you off the axis and drifting sideways. Centre the nozzle in the reticle, then capture.'
    },
    {
      id: 3, name: 'Drifting client', timeS: 120, budgetMps: 0.40,
      startDm: 7, offset: { y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      coneDeg: 1.5, conePeriodS: 90, impingement: false,
      brief: 'The client\'s attitude control loop is sluggish: its nozzle axis wobbles 1.5 degrees every 90 s. Follow the nozzle and capture.'
    },
    {
      id: 4, name: 'Plume discipline', timeS: 120, budgetMps: 0.30,
      startDm: 7, offset: { y: 0.2, z: 0 }, velocity: { x: -0.12, y: 0, z: 0 },
      coneDeg: 0, conePeriodS: 0, impingement: true,
      brief: 'You arrive too fast. Brake early: within 2 m of the ring the braking thrusters fire at the client, and every second of that costs points.'
    },
    {
      id: 5, name: 'Connect', timeS: ARM.connectTimeS, budgetMps: ARM.connectBudgetMps,
      kind: 'connect', docked: true, fullTimeLeftS: 36,
      startDm: null, offset: { y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      coneDeg: 0, conePeriodS: 0, impingement: false,
      brief: 'Docked. The refuelling arm stands on the docking plate. Move the tool over the service valve, lower it gently ' +
        'onto the cap and remove the cap with SPACE, then lower it onto the valve and mate with SPACE within 5 mm of the ' +
        'valve axis. Touch the cap and the valve below 1 cm/s (hold SHIFT for fine motion). Touching the ring, the nozzle, ' +
        'a stanchion, the probe or the client deck fails the attempt.'
    },
    {
      id: 6, name: 'Transfer', timeS: ARM.transferTimeS, budgetMps: ARM.transferBudgetMps,
      kind: 'transfer', docked: true, fullTimeLeftS: 24,
      startDm: null, offset: { y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      coneDeg: 0, conePeriodS: 0, impingement: false,
      brief: 'Connected. Run the leak check of the mated tool, open the valves in order (servicer cargo isolation, line, ' +
        'client fill), start the flow and deliver 150 kg within 2 % (147 to 153 kg). Throttle down before the goal, stop ' +
        'the flow, then close the valves in reverse order. The line processes run at 30x.'
    },
    {
      id: 7, name: 'Depart', timeS: ARM.departureTimeS, budgetMps: ARM.departureBudgetMps,
      kind: 'departure', docked: true, fullTimeLeftS: 48,
      startDm: null, offset: { y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      coneDeg: 0, conePeriodS: 0, impingement: false,
      brief: 'Refuelled. The probe pushes the servicer away at 2 cm/s, straight up from the client. Alone, that push brings ' +
        'it back after one orbit: a purely radial velocity leaves the orbital period unchanged, so the relative orbit closes ' +
        'on itself. Plan a separation burn with an along-track component until the two-orbit prediction turns SAFE, ' +
        'then execute it with SPACE.'
    }
  ],
  // Scenarios: the mission context of every level. Each has its own orbit, lighting, client
  // behaviour and background story; the menu switches between them (left/right arrows or a click).
  scenarios: [
    {
      id: 'geo',
      client: 'relay', // CLIENT_MODELS key: the client's model and inertia
      name: 'Retired relay satellite',
      where: 'GEO graveyard orbit',
      orbit: 'GEO',
      startLocalSolarTimeHours: 9.0, // h
      budgetScale: 1.0,
      spinDegS: 0, // deg/s, client spin about its engine axis
      tumbleConeDeg: 0, // deg, extra coning of the engine axis
      tumblePeriodS: 0, // s
      rollControl: false,
      timeLimitText: 'before the Sun glares into the docking camera',
      timeoutReason: 'Time is up: the Sun now glares into the docking camera.',
      dockedTimeLimitText: 'before the Sun glares into the servicer cameras',
      dockedTimeoutReason: 'Time is up: the Sun now glares into the servicer cameras.',
      story: 'A communications satellite at the end of its service life has been parked in the graveyard ' +
        'orbit, 290 km above the geostationary belt. Its transponders still work but its tanks are almost ' +
        'empty. The servicer docks by pushing a probe into the satellite\'s apogee engine nozzle, then ' +
        'refuels it. The client still controls its attitude and holds still. One orbit lasts 24 hours, so ' +
        'the orbital drift is gentle.'
    },
    {
      id: 'leo',
      client: 'observer', // CLIENT_MODELS key: the client's model and inertia
      name: 'Earth observer',
      where: 'low Earth orbit, 500 km',
      orbit: 'LEO',
      startLocalSolarTimeHours: 9.0, // h, the sunlit Earth below
      budgetScale: 1.0,
      spinDegS: 0,
      tumbleConeDeg: 0,
      tumblePeriodS: 0,
      rollControl: false,
      timeLimitText: 'before the ground-station pass ends',
      timeoutReason: 'Time is up: the ground-station pass has ended.',
      story: 'An Earth-observation satellite in a 500 km orbit is running out of the propellant it needs to ' +
        'hold its altitude against atmospheric drag. The servicer docks during a ground-station pass, with ' +
        'the sunlit Earth below. One orbit lasts 95 minutes: the drift across the docking axis is 15 times ' +
        'stronger than in the graveyard orbit, the Earth fills the background, and the attempt must end ' +
        'before the ground station loses contact.'
    },
    {
      id: 'tumble',
      client: 'derelict', // CLIENT_MODELS key: the client's model and inertia
      name: 'Non-cooperative satellite',
      where: 'GEO graveyard orbit',
      orbit: 'GEO',
      startLocalSolarTimeHours: 9.0, // h
      budgetScale: 1.15,
      spinDegS: 1.2, // deg/s
      tumbleConeDeg: 1.0, // deg
      tumblePeriodS: 120, // s
      rollControl: true,
      timeLimitText: 'before the Sun glares into the docking camera',
      timeoutReason: 'Time is up: the Sun now glares into the docking camera.',
      dockedTimeLimitText: 'before the Sun glares into the servicer cameras',
      dockedTimeoutReason: 'Time is up: the Sun now glares into the servicer cameras.',
      dockedNote: 'After hard capture the servicer stopped the spinning stack with its roll thrusters: the levels ' +
        'docked to this client start from a still stack.',
      story: 'A communications satellite in the graveyard orbit lost its attitude control after an onboard ' +
        'fault and no longer answers commands. Its solar wings stopped at different angles, and it spins ' +
        'slowly about its engine axis while the axis wobbles. ' +
        'The servicer\'s guidance keeps the probe pointed at the nozzle, but before capture you must match ' +
        'the spin: hold U or O to roll until the client stops turning in the docking camera, then capture as ' +
        'usual. A capture with the vehicles still turning would break the probe.'
    }
  ],
  minPulseS: 0.10, // s, a short tap still fires the thrusters this long
  impingementDm: 2.0, // m, braking (-X force) closer than this hits the client with the plume (level 4)
  driftAwayM: 10, // m beyond the start distance the attempt ends
  retractSpeedMps: 0.05 // m/s, the probe pulls the vehicles together after soft capture
};

export const SCORING = {
  captureMaxPoints: 300,
  captureWeights: {
    lateral: 0.25,
    relativeSpeed: 0.25,
    pitchYaw: 0.20,
    pitchYawRate: 0.10,
    dError: 0.10,
    roll: 0.05,
    rollRate: 0.05
  },
  captureExponents: {
    lateral: 1,
    relativeSpeed: 2,
    pitchYaw: 1,
    pitchYawRate: 2,
    dError: 1,
    roll: 1,
    rollRate: 2
  },
  deltaVMaxPoints: 300,
  refuelMaxPoints: 200,
  refuelGoalKg: 150, // kg
  refuelGoalToleranceFrac: 0.02, // dimensionless
  refuelFaultPenalty: 50,
  departureFirstPlanPoints: 200,
  departureCorrectedPoints: 100,
  envelopePenalty: 50,
  camPenalty: 200,
  grades: { A: 900, B: 750, C: 600, D: 400 },
  // Stage 5: the challenge levels score out of 1000 with these weights.
  connectWeights: { precision: 400, time: 300, corrections: 300 }, // points
  transferWeights: { accuracy: 400, faults: 300, time: 300 }, // points
  departureWeights: { safe: 400, deltaV: 300, time: 300 }, // points
  connectCorrectionPenalty: 30, // points per correction (a reversal of the commanded direction)
  transferFaultPenalty: 100, // points per fault
  departureUnsafePenalty: 100, // points per SPACE on an UNSAFE plan
  fullTimeFraction: 0.4 // dimensionless: without a level fullTimeLeftS (s), the time points are full with this fraction of the time left
};

export const ENVIRONMENT = {
  sunAngularRadiusRad: SUN_ANGULAR_RADIUS_RAD, // rad
  earthAlbedo: EARTH_ALBEDO, // dimensionless
  geoDefaultBetaDeg: -9.26, // deg
  leoDefaultBetaDeg: 15.0, // deg
  equinoxBetaDeg: 0.0, // deg
  geoStartLocalSolarTimeHours: 9.0, // h, Sun at 45 deg above the local horizon
  leoStartAfterSunriseS: 300, // s
  geoEclipseThresholdDeg: 8.91, // deg, derived from Earth + Sun angular radii
  cinematicStarsDefault: false,
  visiblePlumesDefault: false,
  hdrExposure: 1.0 // dimensionless
};

function cmXFromD(dM) {
  return dM + CAPTURE.axisOffsetM;
}

export const SCENARIOS = {
  fullMission: {
    name: 'Full mission',
    startDm: 1000, // m
    start: { x: cmXFromD(1000), y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    phase: 'approach'
  },
  closeApproach: {
    name: 'Close approach',
    startDm: 250, // m
    start: { x: cmXFromD(250), y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    phase: 'hold1'
  },
  finalApproach: {
    name: 'Final approach',
    startDm: 20, // m
    start: { x: cmXFromD(20), y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    phase: 'hold3'
  },
  refuellingOnly: {
    name: 'Refuelling only',
    startDm: null,
    start: { x: CAPTURE.dockedCmXM, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    phase: 'docked',
    refuellingComplete: false
  },
  departureOnly: {
    name: 'Departure only',
    startDm: null,
    start: { x: CAPTURE.dockedCmXM, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    phase: 'docked',
    refuellingComplete: true
  }
};

export const CONFIG = {
  MU,
  R_E,
  G0,
  EARTH_SPIN_RATE,
  SUN_ANGULAR_RADIUS_RAD,
  EARTH_ALBEDO,
  DEG_TO_RAD,
  RAD_TO_DEG,
  START_ATTITUDE,
  PHYSICS,
  ORBITS,
  CHASER,
  CLIENT,
  CLIENT_MODELS,
  CAPTURE,
  ARM,
  TANK,
  RULES,
  TIME_WARP,
  CHALLENGE,
  SCORING,
  ENVIRONMENT,
  SCENARIOS
};

export default CONFIG;
