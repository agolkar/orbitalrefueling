# ASSUMPTIONS.md

This file records decisions and simplifications for the Orbital Refuelling Simulator. Where a
requirement is silent or uncertain, the simplest plausible option is used. Where the professor's
later decisions differ from the original prompt, those decisions replace the prompt.

## Scope

- The game is inspired by a publicly released YouTube video of an on-orbit satellite servicing
  mission, used only as a general reference for the type of mission. The servicer, the client and the
  mission are fictional: their shape, dimensions, masses, propulsion, sensors, procedures and
  performance were invented and do not represent in any way the vehicles shown in the video or their
  flight capabilities. They are realistic but entirely fictional examples, built for fun and
  potentially for education. The project is not affiliated with, sponsored or endorsed by the
  authors of the video or
  by any organisation involved in the mission it shows. The code is published at
  https://github.com/agolkar/orbitalrefueling under the MIT License (`LICENSE`).
- The disclaimers (the Disclaimer section of `README.md`, the About screen of the game and this
  section) mention the video without naming any company, spacecraft or mission. Nowhere (code,
  comments, level texts, models, tests, documentation) does the game name, imitate or reproduce a real
  spacecraft, satellite operator, manufacturer, logo, livery or mission graphic.
- The code and the documentation were generated with AI (DeepSeek V4.1 Flash and Claude Opus 5.5)
  from the human author's specification, game design and reviews; the AI disclosure at the top of
  `README.md` and on the About screen says who did what. No file claims a copyright.
- Refuelling is part of the fictional mission: a probe-and-stanchion docking followed by a
  propellant transfer through a service valve.
- Both spacecraft are procedural three.js geometry. The external assets are the Earth texture
  `assets/earth_day.jpg` (NASA Blue Marble, public domain; a procedural Earth is used when it is
  missing) and the voice lines `assets/voice/*.mp3`, rendered by `tools/make_voice.py` (section
  Sound).
- The game uses SI units internally: m, s, kg, N, rad, Pa. Display units convert to bar and degrees.

## Orbit and dynamics

- The GEO graveyard orbit is computed as `a = R_E + 35,786,000 m + 290,000 m = 42,454,137 m`. The
  rounded value 42,454.1 km is not hard-coded.
- The LEO orbit is circular at 500 km altitude with 51.6 deg inclination.
- The GEO graveyard orbit is modelled as equatorial (0 deg inclination).
- The Clohessy-Wiltshire equations use the Hill LVLH convention: x radial away from Earth, y
  along-track, z orbit normal. The three.js scene mapping is `scene = (y, x, -z)` in metres.
- Arcade mode sets `n = 0`, so relative motion is constant-velocity unless control acceleration is
  applied.
- Gravity-gradient, aerodynamic drag, J2, flexible-body dynamics and disturbance torques are
  ignored. Plume impingement is a scoring rule in level 4 of the challenges, without a force model.
- The client keeps its own Earth-pointing attitude until hard capture (in challenge level 3 its
  attitude control is off and its axis cones). After hard capture the servicer controls the stack.
- Earth rotation is modelled. The Earth's surface turns relative to LVLH at `EARTH_SPIN_RATE - n`
  for the equatorial graveyard orbit. For inclined LEO the relative angular velocity vector is
  computed in `src/physics/environment.js`.
- The Sun direction in LVLH is a beta angle and an orbital phase. Shadow visibility uses finite
  angular disks for the Earth and Sun with a circular-overlap area model (smooth penumbra).
- The GEO default beta is -9.26 deg, a solar declination of late February or mid October. The
  graveyard orbit has no eclipse at that beta because `|beta| > 8.91 deg`. The equinox option sets
  beta = 0 deg.
- The LEO default beta is 15 deg. Missions start in daylight.
- Earthshine is `0.30 * f_lit * sin^2(rho_E)` of sunlight, with `f_lit` the lit fraction of the
  Earth's disk seen from the vehicle and `rho_E` the Earth's angular radius. There is no ambient
  light; HDR/ACES tone mapping and exposure are used.
- Hydrazine plumes are almost invisible in vacuum: faint and short by default, brighter with the
  training option.

## Spacecraft mass and inertia

- Client (fictional): dry mass 2,090 kg; mass at docking 2,120 kg with 30 kg in the transfer tank.
  Simple mass model: bus 1,830 kg (propellant included) as a 3.5 x 2.8 x 2.8 m box along LVLH x,
  y, z; two 120 kg wings as uniform rods from 1.4 m to 15.45 m along +/-z, 2.5 m wide; reflectors of
  32 kg at (-1.15, 2.4, 0.3) m and 18 kg at (-0.55, -2.15, -0.4) m. This gives
  `(Ixx, Iyy, Izz) = (23,600, 24,200, 3,500) kg m^2` in LVLH axes, with the CM at the bus centre.
- Servicer (fictional): dry mass 1,600 kg, own RCS propellant 150 kg, cargo propellant 300 kg. The
  bus mass used for inertia is 1,960 kg including propellant but excluding wings (2.5 x 2.0 x 2.0 m
  along body X, Y, Z); two 45 kg wings from 1.0 m to 9.5 m along body +/-Y bring the total to
  2,050 kg. This gives `(4,300, 1,700, 4,700) kg m^2`. Body Y is the wing axis.
- At the start the servicer body X points along LVLH -x, with its docking face toward the client.
  Body Y points along the orbit normal, so both vehicles' wings point north and south.
- A real client of this class burns MMH/NTO in its apogee engine and thrusters. For simplicity the
  game uses one propellant, hydrazine, for both RCS and transfer.

## Capture geometry and hardware

- The client's apogee engine is a 490 N class bipropellant engine: engine length 0.55 m, nozzle
  exit diameter 0.28 m, throat diameter 0.022 m, bell length 0.40 m.
- The launch adapter ring is 1.194 m in diameter (1194 mm clamp-band interface). The nozzle exit
  plane protrudes 0.34 m beyond the ring plane toward the servicer.
- The probe passes through the throat into the combustion chamber. The probe tip diameter is
  0.018 m folded and 0.04 m open. The tip is compliant and is guided by the nozzle bell.
- Probe extension stops when the tip is 0.04 m past the throat. Stroke = d + 0.10 m, maximum
  1.30 m, at 0.22 m/s.
- The three stanchions (capture legs with foot pads) are 0.50 m long with tips on a 0.597 m radius,
  120 deg apart.
- Retraction is 0.50 m in 10 s, slowing to at most 0.01 m/s for the last 0.05 m for a soft seat.
  Final probe extension is 0.60 m, leaving 0.16 m between the nozzle exit and the docking plate.
- During retraction both vehicles move toward their common centre of mass in inverse proportion to
  their masses. The LVLH origin is kept where it was.
- Undocking reverses the sequence: fingers fold, the probe pushes the vehicles apart at 0.02 m/s,
  then withdraws.
- Distances d for hold points, the capture point and callouts are measured along the approach axis
  from the servicer docking face to the client ring plane. The CW state is CM to CM: ring plane
  1.80 m above the client CM, docking face 1.25 m ahead of the servicer CM, so on-axis
  `x = d + 3.05 m`. The capture point is x = 4.05 m, docked x = 3.55 m.
- The KOS radius and HUD range are CM-to-CM.

## Capture scoring

- Capture quality in the mission rules (`captureScore`) uses the peak value of each window value
  during the probe extension: `s = max(0, 1 - (peak / limit)^p)`, with p = 2 for relative speed and
  angular rates and p = 1 for lateral offset, pitch/yaw, roll and d error.
- Capture quality = 300 x sum(weight * s). Weights: lateral 0.25, relative speed 0.25, pitch/yaw
  0.20, pitch/yaw rate 0.10, d error 0.10, roll 0.05, roll rate 0.05. The config names the d error
  `dError` and the speed `relativeSpeed`; `captureScore` maps the window keys to them.
- The challenges score separately (section "Capture challenges").

## Refuelling arm, valve and tank

- The service valve is on the client's aft face outside the ring, 0.85 m from the engine axis, at
  azimuth halfway between two stanchions (60 deg nominal), on a 0.10 m bracket (valve face 0.45 m
  ahead of the servicer docking face when docked), with a red-anodised cap 0.03 m tall.
- The arm is a SCARA arm standing on the servicer docking plate 0.30 m from the probe axis at the
  valve azimuth: shoulder and elbow turn about axes parallel to the docking axis, the two links
  (0.45 m and 0.40 m) sweep planes 0.10 m and 0.17 m ahead of the docking face, and a vertical
  stroke (0.36 m) lowers the tool along the valve axis, so the tool stays parallel to it (the 2 deg
  mating condition holds by construction). Stowed, the second link lies folded back over the first.
  Joint rates are at most 5 deg/s. The arm frame and the kinematics are in `src/physics/arm.js`.
- The slot between the docking face and the client deck is 0.55 m tall. The links clear the ring
  and the deck; the hazards are the stanchions (legs and root boots), the probe, the nozzle, the
  ring wall, the client deck and the sides of the valve. The tool may rest on the cap or the valve
  face (the stroke stops there).
- The client tank is blowdown, isothermal, 0.30 m^3, initial 30 kg, initial ullage pressure 5 bar.
  Propellant density is 1000 kg/m^3. The 22 bar maximum expected operating pressure is a fault
  threshold.
- The servicer cargo tank is regulated at 24 bar. Flow uses
  `mdot = k * opening * sqrt(max(0, p_chaser - p_client - dp_line))`, k = 5e-5 kg/(s Pa^0.5):
  0.068 kg/s at full opening, about 40 minutes for 150 kg at 1x.
- Procedure: leak check of the mated tool first, with the three valves closed (helium at 15 bar up
  to the closed client fill valve, 30 s hold, pass below 1 % drop); then the valves open in order
  (servicer cargo isolation, line, client fill) and close in reverse order. A wrong step is a fault
  and changes nothing. The goal is to deliver 150 kg within 2 %. Leak probability grows with
  probe-extension misalignment and lateral offset; coefficients are in `src/config.js`.

## CAM and departure

- CAM selection uses 26 unit directions with components in {-1, 0, 1}. It discards directions with
  non-positive initial range rate and directions whose range falls below the initial range during
  the first 900 s. Among the rest it maximises the minimum range over [900 s, 2T].
- If no candidate passes, the game takes the direction with the largest minimum range over
  [0, 2T] and shows a warning.
- Departure is SAFE when the closed-form prediction leaves the KOS within one orbit, stays outside
  for two orbits, and never comes within 5 m of the target after the first 60 s.
- A purely radial separation is UNSAFE because the relative orbit closes on itself after one
  orbit. An along-track component makes the servicer drift away.

## Visual design (fictional spacecraft)

- Servicer: an octagonal bus (2.5 m long, 2.0 m across the flats, 0.38 m chamfers). White beta
  cloth with a quilted stitch pattern on the side flats and the rear, black MLI on the chamfers and
  the docking face, silver OSR radiator tiles on the top and bottom flats. Amber Kapton RCS pods on
  the four chamfers at both ends, with a nozzle drawn at every thruster of the plume layout. Two
  roll-out solar blankets (1.4 m wide, 7.6 m long) between silver edge booms, on graphite yokes,
  with a root bar and a tip mandrel. Docking plate in bare aluminium with the amber probe housing,
  the telescoping probe and three capture legs with graphite foot pads and amber boots. A docking
  camera pod above the probe, an LED illuminator below it, a lidar head on a short mast, two
  electric thruster heads and a small white dish at the rear, the refuelling arm base on the plate.
- Client: a charcoal MLI bus (3.5 x 2.8 x 2.8 m) with silver OSR radiators on the north and south
  faces and an amber band. On the aft face a bare aluminium launch adapter ring around a crinkled
  foil heat shield, the apogee engine bell in dark niobium with an aluminium exit lip, the service
  valve with an amber boot and a dark cap, amber corner RCS blocks and two omni antennas. On the
  Earth deck feed horns and a small dish on a tower. Two unequal white reflectors on graphite hinge
  arms (2.5 m and 1.6 m). Two wings of four 2.5 x 3.05 m panels on graphite V yokes.
- Solar cells on both vehicles: dark violet cells with silver bus bars. Panel backs are grey.
- Guidance graphics use teal (approach axis dashed, ring markers, callouts, reticle, HUD labels);
  orange marks actions and warnings; green marks values inside the capture window; red marks
  failures. The approach axis is guidance only, not hardware.
- The client has no docking target. The docking camera aims at the nozzle and the ring.

## Rendering conventions

- Two-pass rendering: background scene in kilometres (Earth, Sun, stars), depth clear, foreground
  vehicles in metres.
- LVLH to scene: (x, y, z)_scene = (y, x, -z)_LVLH, quaternion `LVLH_TO_SCENE` = (x, y, z, w) =
  (sqrt(1/2), sqrt(1/2), 0, 0). The target's scene orientation is `LVLH_TO_SCENE * q_client`; the
  servicer's is `LVLH_TO_SCENE * attitude`.
- Models are built in their own body axes. CylinderGeometry and LatheGeometry run along local +Y:
  rotation.z = -PI/2 turns them to +X, rotation.x = PI/2 to +Z. A TorusGeometry gets its axis along
  X with rotation.y = PI/2.
- Azimuth about the approach axis: on the servicer from body +Z toward body +Y, on the target from
  +y toward +z, so both agree when docked. Service valve and arm base at 60 deg, between the
  stanchions at 0, 120 and 240 deg.
- Solar wings sit in pivot groups and track the Sun about the wing axis. With s the Sun direction
  in the model's body axes: servicer pivots rotation.y = atan2(s.z, -s.x), target pivots
  rotation.z = atan2(-s.x, s.y).
- Reflections: a PMREM of the background scene without the Sun disk and the stars, made at the
  start and then every 10 s. The MLI crinkle canvases are bump maps in linear colour space.
- The stowed probe tip sits 0.15 m in front of the docking face; `probeGroup` (the rod and tip)
  slides along +X during capture out of a fixed housing; the rod's back end stays inside the hull up
  to the full 1.30 m stroke.
- Docking camera: on the docking face at body (1.32, 0, 0.15) m, 0.15 m above the probe axis,
  canted 9 deg toward it, field of view 40 deg, so the nozzle stays near the image centre from 7 m
  to the capture point. Its pod and lens sit behind the camera position. The reticle marks where
  the probe axis pierces the nozzle exit plane (0.34 m in front of the ring plane), so it sits on
  the nozzle when the two are aligned.
- Approach axis: a dashed line from the nozzle exit outward with ring markers and HTML callouts at
  x = 1.80 + d; the callout labels are hidden in the docking camera, where they would sit on the
  line of sight.
- Earth texture `assets/earth_day.jpg`: NASA Blue Marble Next Generation with topography and
  bathymetry, February 2004, 5400 x 2700 (credit: NASA Earth Observatory).

## Tests and build

- Tests are plain `.mjs` files with a local assert helper. They run with `node tests/run.mjs` and
  `deno run --allow-read tests/run.mjs`: physics (1 to 30), mission rules (R1 to R16), challenges and scenarios
  (31 to 40), arm, tank, de-spin and the docked levels (41 to 55), sound (56 to 60) and gamepad
  (61).
- Physics, rules and challenge modules never import three.js and never touch the DOM.

## Corrections from the professor's reviews of Stages 1 and 2

- Sun: at local solar time h the Sun's phase in the orbit plane is 2*pi*(12 - h)/24 (noon at +x,
  06:00 at +y) and it turns at -n in LVLH: `sunDirectionAtTime(beta, h0, n, t)`. The GEO scenario
  starts at 09:00 local solar time.
- Earth: the polar axis is fixed in inertial space and cones about the orbit normal in LVLH.
  `earthOrientationLVLH(orbit, t)` gives the rotation from Earth-fixed axes to LVLH. The GEO
  sub-satellite longitude starts at 19.0 deg W and drifts 3.72 deg west per orbit in the graveyard
  orbit.
- Servicer start attitude: `START_ATTITUDE` (w, x, y, z) = (0, 0, sqrt(1/2), sqrt(1/2)): docking face
  toward the client, wings along the orbit normal.
- Propellant: every firing thruster consumes F / (Isp g0). A combined burn sums the flows of all
  firing axes; its delta-v comes from the resultant force.
- Attitude: kinematics q' = 0.5 q * omega with body rates relative to LVLH. Each axis has a 44 N m
  couple. The hold is a PD controller (wn = 0.4 rad/s, zeta = 1) with on-time modulation, minimum
  pulse 0.01 s; `attitudeHoldStep` returns the torque actually applied.

## Stage 3 flight (corrected after review)

- `src/physics/flight.js` holds the flight step, with no three.js and no DOM. The flight state is
  the CW state in LVLH (CM to CM, client at the origin) plus the burn queues and the elapsed time;
  the vehicle (`ChaserVehicle`) holds mass, propellant, attitude, body rates and the hold. There is
  one attitude state: the vehicle's.
- Each frame advances dt x warp of simulated time in equal sub-steps: at most 0.05 s while the hold,
  a rotation or a burn is active, otherwise at most 0.5 s (RK4), and at most 2000 sub-steps per
  frame. A 2000x frame of 33 s matches the closed form within 1e-6 m.
- Thrust acts along the body axis, rotated to LVLH by the current attitude. Propellant: 44 N /
  (Isp g0) per firing axis; the delta-v used is the integral of |a| dt.
- Held translation (`translationHeld`) fires an axis for as long as its key is held; queued pulses
  (`queuePulse`) burn a given delta-v. Opposite commands do not cancel, each burns its own
  propellant.
- Time warp rules (`maxWarpAllowed`) remain in the flight module for longer phases: every level
  outside the KOS, at most 50x inside it, 10x within 30 m and 1x within 4.5 m; any thrust or control
  input means 1x. The challenges run at 1x.
- Plumes: thrusters on the bus corners (four aft for +X, four forward canted 15 deg outward for -X,
  diagonal pairs for +/-Y and +/-Z); the rotation couples use opposite lateral thrusters. Faint by
  default; URL `?plumes=bright` is the training view.

## Stage 4 mission rules (corrected after review)

- The pure rules (zones, envelope, capture window, CAM, departure, scoring) live in
  `src/game/rules.js`; the phase state machine of a full mission lives in `src/game/mission.js`.
  Neither imports three.js nor touches the DOM. The challenge game uses its own short state machine
  (`src/game/challenge.js`); `rules.js` and `mission.js` stay as tested modules for the later
  levels (CAM, departure check, refuelling and undocking phases, scoring).
- The capture window uses the same alignment values the HUD shows. The Arcade mode doubles every
  tolerance.
- Capture sequence in `mission.js`: extension 5 s, fingers 1 s, retraction 10 s, then HARD_CAPTURE,
  then 5 s of latching (`CAPTURE.latchTimeS`) before `docked`. The window is checked during the
  extension only: once the fingers hold the client, the retraction pulls the vehicles together and
  d leaves the window by design. Leaving the window during the extension is PROBE_ABORT (50-point
  penalty), back to the final approach.
- Hold points HP1 (250 m), HP2 (80 m), HP3 (20 m): a hold is complete within 2 m (0.5 m at HP3) at
  under 0.01 m/s for 10 s. The GO at HP1 also grants the KOS entry.
- The speed envelope is checked against the magnitude of the relative velocity (a simplification of
  the closing speed).
- The approach corridor is a cone with a 10 deg half-angle about LVLH +x, apex at the ring plane
  (x = 1.80 m), applied inside the KOS only.
- Collision: a CM-to-CM distance test against the sum of half-extents along the approach axis
  (servicer 1.25 m, client 1.75 m). The 0.3 m/s limit applies at contact only; far from the client a
  CAM impulse or a fast approach is not a collision.
- Scoring of a full mission: capture quality up to 300, delta-v efficiency up to 300 (reference
  0.30 m/s), refuelling up to 200 minus 50 per fault, departure 200 for the first plan or 100 after
  corrections, penalties -50 per envelope or corridor violation and -200 per CAM. Grades A from 900,
  B from 750, C from 600, D from 400, otherwise F.
- Corrections after review: `captureScore` read its weights under the wrong keys (a perfect capture
  scored 195 instead of 300); the hard-capture phase ended in the same step it started because its
  timer was not reset; a relative speed above 0.3 m/s anywhere failed the mission as a collision,
  so every CAM impulse ended the mission. Tests R15 and R16 cover these cases.

## Scenarios and cameras (professor's request after Stage 4)

- Three scenarios, switched on the menu with the left and right arrows or a click (config
  `CHALLENGE.scenarios`, URL `?scenario=geo|leo|tumble`, the last choice kept in localStorage
  `refuelScenario`). Each has its own background story, orbit, lighting, client behaviour, time-out
  reason and best scores. The orbit and the Sun change at run time (`setOrbit` in
  `src/render/scene.js`), without reloading the page.
- Retired relay satellite (geo): GEO graveyard orbit, start at 09:00 local solar time, cooperative
  client, time limit set by the Sun reaching the docking camera's field of view.
- Earth observer (leo): circular 500 km orbit (n = 1.1068e-3 rad/s), start at 09:00 local solar time
  with the sunlit Earth below, cooperative client, time limit set by the ground-station pass. The CW
  terms are 15 times stronger than in the graveyard orbit: closing at 10 cm/s, the Coriolis term
  (2.2e-4 m/s^2) pushes the servicer about 40 cm sideways in a minute if nobody corrects it, against
  about 3 cm in the graveyard orbit. A start time before sunset can be set with
  `sunsetAfterS` (`startLocalTimeBeforeSunset`): the servicer's lamp then lights the client, which
  stays readable in the docking camera.
- Non-cooperative satellite (tumble): GEO graveyard orbit; the client lost its attitude control and
  spins at 1.2 deg/s about its engine axis while the axis cones 1.0 deg every 120 s. The servicer's
  guidance keeps the probe on the nozzle axis (pointing only); the player commands the roll with U
  and O. A held key changes the commanded roll rate by 44 N m / 4,300 kg m^2 = 0.59 deg/s per
  second, a tap by at least 0.059 deg/s (0.10 s); the attitude hold follows the command with its
  usual lag (natural frequency 0.4 rad/s). The capture window requires the relative roll rate below
  0.2 deg/s. At soft capture the roll offset is frozen and the servicer turns with the client. The
  RCS budget is 15 % larger because following the wobble costs delta-v.
- Cameras: C cycles chase, docking and free. The capture levels and the departure open on the chase
  view (professor's request after Stage 5): it looks at the point halfway between the two
  spacecraft and backs off as they move apart (at least 6 m + 1.1 times their distance), so both
  stay in view. In the chase and free views the docking camera is drawn in a window in the lower
  right corner (30 % of the width, 16:9, `src/render/pip.js`), with its own reticle, distance and
  closing speed, so the game stays playable from the outside views. The window reuses the shadow
  map of the main view and hides the approach axis. A badge at the top left names the active camera
  and the view C switches to; it glows for the first seconds of each attempt, until C is pressed,
  and the countdown line and the brief say the same. The view chosen with C carries over to the
  next attempt.

## Capture challenges (the game as it stands)

The game consists of short challenges built on the same physics: one attempt lasts at most two
minutes at 1x, and each level trains one piloting skill.

- Over two minutes the orbital terms are small but real: closing at 10 cm/s along the radial
  approach axis, the Coriolis term 2n x (closing speed) pushes the servicer sideways by a few
  centimetres per minute, and the player has to correct it.
- No time warp and no long-term prediction line: the predicted coasting path over one orbit, drawn
  in the LVLH frame that rotates with the client, is an ellipse drifting along-track, correct and
  confusing for a player.
- Levels (config `CHALLENGE.levels`): 1 First capture, 5 m at rest, 100 s, 0.30 m/s budget;
  2 Off the axis, 7 m closing at 3 cm/s with a 43 cm offset and a sideways drift, 110 s, 0.35 m/s;
  3 Drifting client, 7 m, the client's nozzle axis precesses on a 1.5 deg cone every 90 s (attitude
  control off, a gentle case a servicer can still capture), 120 s, 0.40 m/s; 4 Plume discipline,
  7 m closing at 12 cm/s, braking within 2 m of the ring fires the -X thrusters at the client, 120 s,
  0.30 m/s.
- Controls: hold W/S to close in or brake, hold the arrow keys to move as seen in the docking
  camera (left/right = body +/-Y, up/down = body +/-Z); thrust lasts as long as the key is held, a
  tap fires at least 0.10 s. The attitude control keeps the probe on the client's nozzle axis
  (`trackingAttitude`); rotation is not a player task.
- Recommended closing speed for the distance d: clamp(0.02 + 0.04 (d - 1), 0.02, 0.10) m/s, shown
  as a green band from 40 to 100 % of it on the closing-speed tape. Feedback names the keys to press
  and tells the player to wait when the servicer is already sliding toward the axis.
- Capture window (config `CAPTURE`): d 1.00 m +/- 0.15 m, probe tip within 10 cm of the nozzle
  axis, relative speed below 2 cm/s, pitch/yaw and roll within 4 deg, rates below 0.2 deg/s. SPACE
  inside the window extends the probe at 0.22 m/s (stroke d + 0.10 m); SPACE outside gives NO GO and
  the reason. The tip must pass the nozzle exit plane within 12 cm of the axis, otherwise it strikes
  the rim. Soft capture at full stroke; retraction at 0.05 m/s to d = 0.50 m is automatic.
- An attempt fails on time out (the Sun reaches the docking camera's field of view), RCS budget used
  up, contact before capture, drifting 10 m beyond the start distance, or a rim strike.
- Score out of 1000: 400 precision at capture, 300 time (full with 40 % of the time left), 300
  propellant (full with half the budget left), minus 40 points per second of plume impingement or
  of relative speed above 10 cm/s (at most 300). Stars: 750 or more three, 550 or more two, else
  one. Best scores stay in the browser (localStorage `refuelBest`). SPACE on the result screen
  retries at once (after a 1 s guard), N opens the next level.
- A tapping bot with 0.25 s reaction wins all four levels within their limits in every scenario
  (tests 37 and 40); a browser run with real key events wins the levels.
- URL: `?scenario=geo|leo|tumble` selects a scenario, `?level=1..7` opens a level brief;
  `?plumes=bright` for the training plumes.

## Docked levels 5 to 7 (Stage 5, corrected after review)

The docked levels use the challenge format of the capture levels: a brief, a 3-2-1 countdown, play,
a result screen with score, stars and best score, and the same keys (SPACE retries, N opens the next
level, Esc returns to the menu). They run in all three scenarios and start from a still stack.

- De-spin: after hard capture with the spinning client (non-cooperative scenario), the servicer
  stops the stack with its roll couple: 44 N m on the servicer and client roll inertias about the
  common docking axis (4,300 + 23,600 kg m^2), 0.090 deg/s per second, about 13 s from 1.2 deg/s.
  The result appears after the de-spin (SPACE skips it), with a status line and a result row. The
  levels docked to that client start still (`levelFor` drops spin, wobble and roll control).
- Scenario texts: the docked levels time out because the Sun glares into the servicer cameras (GEO
  scenarios) or because the ground-station pass ends (low Earth orbit).
- Level 5 Connect (90 s): the arrow keys move the tool across the docking axis as seen in the tool
  camera (up = away from the docking axis, towards the valve), W lowers it and S raises it, SHIFT
  slows every motion to a fifth (0.8 cm/s across, 0.6 cm/s along the axis). The tool moves at
  4 cm/s across (through inverse kinematics; both joint increments are scaled together so neither
  passes 5 deg/s, which keeps the direction and slows the tool where the arm needs large joint
  motions) and 3 cm/s along the axis. The capture leaves the stack up to 3 deg off in roll (inside
  the 4 deg window), drawn at random per attempt, so the valve sits up to 4.5 cm away from its
  nominal place across the arm. Sequence: touch the cap below 1 cm/s, SPACE within 10 mm of the
  valve axis unscrews it (3 s) and stows it on the tool; touch the valve face below 1 cm/s, SPACE
  within 5 mm mates. Faster contact, or touching a stanchion, the probe, the nozzle, the ring wall,
  the client deck or the side of the valve, fails the attempt. Score: 400 precision at mating
  (1 - offset / 5 mm), 300 time (full with 36 s left), 300 minus 30 per correction (a reversal of
  the commanded direction on one axis).
- Views of level 5: the tool camera (default) looks along the tool axis from 0.25 m above the tip
  (never behind the docking plate), with the arm hidden in it, so the image centre is the tool
  axis; the chase camera looks into the slot from the side; the outside views keep the tool camera
  in the corner. The scope shows the arm from above and a tool height gauge with the cap, valve,
  ring and deck levels. A floodlight on the docking plate, the tool LEDs and a fill light light the
  slot, which is otherwise mostly in the servicer's shadow.
- Level 6 Transfer (120 s): L runs the leak check, 1 2 3 open the valves in order (and close them
  in reverse order), SPACE starts and stops the flow, the up and down arrows set the flow-control
  opening (5 to 100 %, 50 % per second). The line processes (leak check and transfer) run at a fixed
  30x, written on the screen; the level clock runs at 1x. At full opening 150 kg take about 80 s on
  screen, so the player keeps the valve open and throttles down near the goal. Passing 153 kg fails
  at once (the goal can no longer be met); closing the line below 147 kg fails; the attempt ends
  when the last valve closes after the flow. A valve key during the leak check is a NO GO, not a
  fault. Score: 400 accuracy (1 - error / 3 kg), 300 minus 100 per fault, 300 time (full with 24 s
  left). The client stays far from 22 bar (11.25 bar at the goal); the limit remains a failure.
- Level 7 Depart (120 s to plan): the probe pushes the servicer away at 2 cm/s along the docking
  axis (LVLH +x) and releases the client in 3 s (the probe retracts); the servicer keeps drifting
  while the player plans. The translation keys add delta-v to the plan at the RCS acceleration of
  the refuelled servicer (44 N on 1,900 kg, 2.3 cm/s per second): up and down arrows along-track,
  S and W radial (up, down), left and right out of the orbit plane; Backspace clears the plan. SAFE
  needs the departure check of the rules and, for the first 60 s, no return to contact (CM to CM
  above 3.55 m). SPACE executes a SAFE plan within the 0.20 m/s budget (0.23 m/s against the
  non-cooperative client); SPACE on an UNSAFE plan is refused and counted. After the burn the coast
  runs at 100x (T and G change it, 1x to 400x) until the range passes 30 m. The LVLH plot opens
  with the two-orbit prediction at a scale that shows it whole. Score: 400 minus 100 per refused
  UNSAFE burn, 300 for the delta-v left in the budget, 300 time at the burn (full with 48 s left).
- With the 2 cm/s push, the smallest SAFE along-track burn is about 0.3 mm/s forward or 1.5 mm/s
  backward in the graveyard orbit (the 3.55 m height offset alone drifts the servicer 134 m per
  orbit) and about 4 mm/s forward or 22 mm/s backward in low Earth orbit; a forward burn in the
  first seconds of planning needs about 12 mm/s there, because the servicer would still be within
  5 m of the client a minute later.
- Scripted players win the three levels in every scenario (tests 47 to 49, Connect also at roll
  offsets of -3, 0 and +3 deg); browser runs with real key events win levels 5 and 6.
- Design choices that differ from the first Stage 5 draft: the arm base moved from 0.80 m to 0.30 m
  from the probe axis (at 0.80 m the valve sat 5 cm from the shoulder, at the edge of the reach of
  0.45 m and 0.40 m links); the arm became a SCARA with a vertical stroke (a planar two-link arm
  cannot hold the tool parallel to the valve axis); the leak check moved before the valves (it
  tests the mated interface against the closed client fill valve); the leak check runs at 30x with
  the transfer; the undock push points away from the client; the departure time limit applies to
  the planning.

## Sound (added after Stage 5, at the professor's request)

- Everything is made in the browser except the voice: the music (`src/audio/music.js`) and the
  effects (`src/audio/sfx.js`) are synthesized with the Web Audio API. The audio context starts at
  the first key press or click, as browsers require.
- Music: an original dark synth piece in D minor at 92 BPM (two four-chord progressions of two bars,
  detuned saw pads, a sub bass with a saturated saw an octave up, a filtered arpeggio through a
  dotted-eighth ping-pong delay, a half-time beat, occasional high data blips). One intensity value
  from 0 to 1 arranges it, followed with a 2.5 s lag: far from the client pads and a long bass
  (about 0.3), the rolling bass from 0.4, the arpeggio from 0.2 to 0.6, the hi-hats from 0.45, the
  beat from 0.6. In the capture levels the intensity rises from 0.28 to 0.68 with the approach and
  adds 0.15 in the capture window and during the probe sequence. The music ducks by 6 dB under the
  voice and goes muffled (low-pass at 650 Hz) in pause.
- Effects: thrusters (a filtered hiss while firing, a thump for every tap), probe motor, soft and
  hard capture latches, collision, arm servos (following the joint speed), cap ratchet, valves,
  propellant flow (following the opening), leak-check helium hiss, undocking push, separation burn,
  fast-forward, countdown beeps, chimes, NO GO buzz, master caution, result tones. Space carries no
  sound: these stand for what a crew would hear through the structure and the headset.
- Voice: 47 short lines (`src/audio/lines.js`) rendered once to `assets/voice/*.mp3` (mono, 64 kbit/s)
  with the open Kokoro-82M text-to-speech model, voice af_heart, by `tools/make_voice.py`; every
  line was checked by transcribing it back with a small speech-to-text model, and five unclear
  phrasings were replaced (for example "Extending the probe." for "Probe extending."). A two-tone
  data chirp announces each line. If a file is missing, the browser speech synthesis reads the text.
- When the voice speaks (`src/audio/director.js`): range at 5, 3 and 2 m (once per attempt, not the
  distance the attempt starts at), the capture window, the probe sequence and the outcome; warnings
  (too fast, too close, plume on the client, NO GO, spin, tank pressure) at most every 3 to 10 s;
  30 s and 10 s left; one line per step in the docked levels (over the valve, cap removed, leak
  check, line open, flow, 10 kg to go, in the band, separation, SAFE, burn). The queue keeps 0.35 s
  between lines, puts warnings first, drops an information line that waited more than 2.5 s and lets
  a failure cut in. Scripted captures hear 7 to 11 lines in 90 to 125 s.
- B turns the music on and off, V the voice, K all sound; the menu's settings line also sets the
  master volume. The settings are kept in localStorage `refuelAudio`.
- Levels (offline renders): music about -23 dBFS RMS at the default volume, voice about -19 dBFS
  RMS, effects peaks between -26 and -4 dBFS, a soft master compressor above -14 dBFS.

## Stage 6 polish (DeepSeek, reviewed)

- Gamepad (`src/input.js`): the pad works as a keyboard. `padKeyCodes` turns the standard mapping
  into key codes every frame (left stick and d-pad = arrow keys, right stick vertical = W/S, triggers
  = U/O, shoulders = SHIFT, A = SPACE, B and Start = Esc, X = C, Y = M, Back = F1); a key that goes
  down is a press, as on the keyboard, so PULSE taps, held thrust, the arm, the plan and the menus all
  work with the pad. Sticks count past half deflection and let go below 0.35, triggers past 0.3. Level
  6 still needs the keyboard for L and the valves 1, 2, 3, level 7 for Backspace, T and G. (DeepSeek's
  version fed the sticks to the held intents only, so PULSE taps and the docked levels ignored the
  pad, and the triggers both rolled and moved up and down.)
- Menu: the up and down arrows select a level (highlighted) and SPACE or Enter opens its brief, so
  the menu works with the keyboard alone and with the pad.
- Settings line on the menu (S flashes it): music, voice, all sound (K), master volume in steps of
  10 %, dim or bright thruster plumes, the corner camera window. Plumes and corner window are kept in
  localStorage `refuelSettings`, the sound in `refuelAudio`.
- Mission diagram on the menu (top right): Earth's limb and the scenario's orbit, the graveyard
  orbit above the geostationary belt or the 500 km low orbit, the servicer approaching the client
  (marked spinning for the non-cooperative satellite). Schematic, not to scale, generic icons.
- Performance: the frame loop reuses vectors and quaternions (`src/main.js`,
  `src/render/cameras.js`, `src/dockedPlay.js`); the pixel ratio stays capped at 2.
- DeepSeek's synthesized `src/audio.js` (puffs, clunk, valve click, flow hiss, warning tone, cabin
  hum, K to mute) was replaced by the sound of `src/audio/` (section Sound); K now turns all sound
  on and off there.

## Known limitations

- Relative motion follows the Clohessy-Wiltshire equations without perturbations (J2, drag, solar
  pressure, third bodies) and without gravity-gradient or disturbance torques. Over the two orbits
  of the departure prediction (48 h in the graveyard orbit) differential drag, J2 and differential
  solar radiation pressure would matter.
- The departure check samples the two-orbit prediction at 360 points (every 8 minutes in the
  graveyard orbit, every 32 s in low Earth orbit), so a slow pass within 5 m between two samples
  can escape the 5 m condition.
- The client's attitude is prescribed (cones and a spin). Its engine axis is the intermediate axis
  of inertia (3,500 < 23,600 < 24,200 kg m^2): a torque-free spin about it would be unstable, with
  an e-folding time of about two minutes at 1.2 deg/s.
- Rigid bodies with fixed inertia; the solar wings and reflectors do not flex.
- The arm is kinematic: no joint dynamics, compliance or backlash; contact is a geometric clearance
  test, not a force.
- One propellant (hydrazine) for the RCS and the transfer, although a real client of this class
  burns a bipropellant in its apogee engine; the transfer line is lumped (one pressure drop, one flow
  coefficient) into an isothermal blowdown tank.
- Lighting is simplified: directional Sun, earthshine, fill lights, no thermal effects.
- Valve access is simplified. On a satellite not designed for servicing, the fill and drain valve
  sits under the thermal blankets, is lock-wired and closed by two caps, and every step (cutting
  the blanket and the wire, removing each cap, connecting the tool) takes far longer than in the
  game, under close supervision from the ground. Level 5 keeps one cap and unscrews it in 3 s.
