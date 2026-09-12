# Cold-start minigame plan

Status: planned gameplay; this document adds no new controls or playable mode.

The current animated studies begin with a burning stack and warm coals. This refinement adds visible per-log moisture and a Core heat health indicator; heat also changes fuel consumption. Logs already settle as their supports burn away, with hot impacts producing embers and audio. Starting from an empty, cold bed, placing kindling, applying starter fluid, using ignition tools, and blowing on a young fire are the next phase.

## Player flow

1. Choose **Build a fire** to begin with an empty, cold pit and a finite supply of tinder, kindling, logs, starter tokens, and ignition-tool uses. Keep the existing burning study available separately.
2. Place tinder and kindling near the center, then stack selected logs. Each log shows its moisture before placement. Arrangement previews show whether the small fuel is sheltered, smothered, or exposed to enough air.
3. Optionally spend an abstract starter-fluid token on a cold, unlit pile. The token gives the small fuel a brief ignition advantage and is consumed; it cannot refill or sustain a burning fire.
4. Choose a lighter, match, or flint and target the small fuel. A short localized heat source starts the attempt. Sparks or a bright flash alone do not mean the fire has caught.
5. Watch **Core heat** and its trend. Add kindling and use short **Blow** actions to nurture a fragile flame. Sustained heat must dry nearby wood before the logs catch.
6. Reach a self-sustaining fire, then maintain it with the remaining supply. Adding a wet log takes heat out of the core while it dries. Very hot fires consume logs faster and need more frequent tending.
7. Let the fire burn down, recover a fading ember bed, or restart an extinguished attempt with whatever supplies remain. Show why an attempt stalled and the available recovery action.

Heat, moisture effects, and tool resources use normalized game values.

## State and resource model

Use one session state machine, separate from each fuel item's drying/burning/char/ash phase. Apply hysteresis and a minimum dwell time when crossing heat thresholds so the status does not flicker.

| State | Meaning and transition |
| --- | --- |
| `cold` | No flame or useful retained heat. Placement and ignition preparation are available. An ignition action enters `igniting`. |
| `igniting` | A finite external heat source is active. Small fuel catching enters `fragile`; expiration without combustion returns to `cold`. |
| `fragile` | Small fuel burns, but the stack cannot yet sustain itself. Sustained core heat and a burning log after the ignition source ends enter `established`. Losing flame with retained heat enters `embers`; otherwise return to `cold`. |
| `established` | The wood and ember bed maintain useful heat without starter or tool input. Falling below the stable threshold enters `fading`. |
| `fading` | Heat or flame is declining. Fuel and sufficient airflow can recover `established`; loss of visible flame enters `embers`. |
| `embers` | Useful retained heat remains without sustained flames. Suitable small fuel can return the fire to `fragile`; cooling to zero returns to `cold`. |
| `spent` | No combustible material or usable ignition/recovery supplies remain. The session can be inspected or restarted. |

Start with zero coal mass, zero coal/core heat, zero flames, and no decorative burning twigs. Add physical fuel from the inventory, never from a replenishing timer. The current study's `addLog()` can manufacture a fresh log when an ash slot is reused; the minigame must instead transfer an existing inventory item into a free slot. A vacated slot is capacity, not a new resource. Disable automatic feeding in this mode.

Keep stable IDs on inventory and placed items. Store `kind` (tinder, kindling, log), remaining fuel, char, ash, `moisture`, `initialMoisture`, density, temperature, flame, placement, and contact relationships. Preserve the existing seven large-log slots for the first playable; keep smaller fuel in a separate collection so kindling cannot displace a whole log accidentally.

Ignition tools have distinct but bounded behavior:

- **Lighter:** predictable short heat input that consumes a finite charge budget.
- **Match:** one finite heat pulse per match; a failed attempt still consumes it.
- **Flint:** a brief spark pulse with a smaller contact area, using a limited attempt budget. Success depends on tinder dryness and preparation, with seeded variation if needed.

Represent starter fluid as finite game tokens and a short-lived modifier on targeted small fuel. Only accept it when the entire pile is cold and unlit: no active ignition source, flame, or useful retained ember heat. Revalidate when the action executes, consume once, and display the reason if unavailable. Store no real-world volumes or application instructions.

## Heat, moisture, and air

Use `cycle.coreHeat` as the single displayed heat value, preserving `coalHeat` compatibility for existing shaders and audio. The current implementation exposes `coreStatus` as Cold, Fading, Warming, Healthy, or Very hot, and `burnRateMultiplier` as `0.65 + coreHeat * 1.10`. Reuse those fields and tune the cold-start transitions around them instead of creating a disconnected health score. The meter should show percentage, status, recent direction, and the current burn-rate effect; color must have a text equivalent.

Extend the fixed-step heat model with heat from tinder, kindling, ignition pulses, and retained char; losses from ambient cooling and evaporating moisture; and a bounded oxygen factor. Wet wood must spend time and local heat drying before sustained ignition. High heat increases fuel consumption only where fuel is already burning; a high meter alone must not silently consume cold, wet inventory logs. Conserve fuel through wood, char, and ash without allowing negative values.

Placement affects three separate properties: support contacts, heat transfer between neighboring items, and airflow. Open crossings expose small fuel to air; very dense packing reduces oxygen, while excessive separation reduces heat transfer. Calculate these from the same logical placement data used to position the visuals. Keep the volume shader's depth occlusion for rendering; a hidden pixel is not a simulation airflow measurement.

`Blow` applies a short, capped oxygen pulse to an existing flame or hot ember target. It cannot add fuel or light a cold pile. The first playable uses discrete pulses with a cooldown and an explicit active duration, rather than rewarding frantic clicking. Once the oxygen cap is reached, repeated attempts provide no extra heat; show “Airflow already boosted.” Cooling and insufficient fuel can still overwhelm the benefit.

## Integration and clocks

| Module | Planned responsibility |
| --- | --- |
| `src/lifecycle.js` | Add a cold-start reset mode, session state, inventory, small fuel, action validation, ignition sources, airflow, drying heat cost, and derived hints. Retain seeded reset and fixed half-second integration. |
| `src/log-settling.js` | Accept placed log layouts and support relationships. Continue animating gravity, tipping, and impacts at natural speed. |
| `src/burn-visuals.js` | Render placed small fuel and tool/airflow feedback from model state. Remove time-only twig shrinkage and twig flames in this mode; use actual remaining small-fuel mass and heat. |
| `src/scene.js` | Route actions to the lifecycle, reset both clocks and pending effects together, and rebuild placement/depth when geometry changes. |
| `src/burn-panel.js` | Add mode selection, inventory, placement, ignition, and tending controls; reuse the heat meter and moisture labels. |
| `src/fire-audio.js` | Add short tool and blowing sounds; retain the shared impact event that synchronizes log pops and ember bursts. Respect mute, pause, visibility, and user-enabled audio. |

Fuel, moisture, heat, resource consumption, and gameplay events run on the fixed burn clock. Flame flicker, gravity animation, drifting embers, and sound envelopes run on the natural animation clock. Queue actions with a sequence ID for the next burn step and process each once; pauses disable consuming actions, and hidden tabs suspend both clocks without catch-up.

Cold-start tending runs at 1× in the first playable; unlock the existing speed selector once the fire is established. This avoids making the player's ignition or blowing window disappear at 1200×. Automated model tests can still replay a timestamped action sequence at any integration chunk size.

Do not feed frame-by-frame visual log poses back into burn calculations: current gravity uses real time and would otherwise change heat outcomes at different playback speeds. Make placement and support changes authoritative model events on fixed steps, including a deterministic support-failure condition based on remaining fuel. Update the logical contact/airflow graph then; let the visible stack settle toward the new arrangement at natural speed. Emit a uniquely identified impact when the visible landing occurs, so one landing creates one ember burst and one sound. Reset clears pending actions and transient effects; resume never replays old pops.

## First playable milestone

Ship an optional cold-start mode in studies 07 and 08. Use a few selectable stack arrangements and placement slots with keyboard-accessible controls before adding unrestricted dragging. Include finite inventory, visible log moisture, tinder/kindling placement, one abstract starter action, all three ignition choices, a discrete Blow control, heat trend and contextual feedback, and recovery to a successful self-sustaining burn. Existing controls and the warm-start study remain available.

Success means at least one log continues burning and core heat remains in the healthy band for a defined simulation interval after all ignition, starter, and blowing effects expire. A momentary flare is not success. Initial thresholds and inventory counts are tuning constants, not claims about real wood; choose them through deterministic scenarios and playtesting.

Defer freeform picking/dragging, arbitrary new stack geometry, wind/weather, scores, persistent progression, tool animations, and thermodynamic calibration until that loop is clear and enjoyable.

## Failure, recovery, and acceptance

| Situation | Feedback and recovery |
| --- | --- |
| Ignition pulse ends without catching | “The small fuel did not catch.” Identify wet fuel, poor contact, or inadequate airflow; retain unburned resources and allow another prepared attempt. |
| Wet logs absorb the young fire's heat | Show drying moisture and falling core heat. Add available kindling or rearrange the stack while the heat source remains. |
| Stack smothers the small flame | Show restricted airflow and highlight the affected placement. Open the arrangement or apply a bounded Blow pulse. |
| Only warm embers remain | Offer kindling and tending if they can still recover combustion; show when a new ignition source is required. |
| Recovery supplies are exhausted | Report what remains, stop suggesting impossible actions, and offer a fresh session. |

Acceptance checks for the implementation:

- A cold start has no invisible initial heat, self-lighting logs, decorative flames, automatic fuel, or fire ambience.
- Identical seeds and actions give identical fuel, moisture, heat, inventory, and session transitions whether `advance()` receives small or large time chunks.
- Matched dry and wet logs show different drying/ignition times; very hot burning logs consume fuel faster than equally burning logs at lower core heat.
- A well-prepared baseline can establish a fire without starter fluid; starter assistance is finite and never substitutes for sustained fuel.
- Bad airflow and wet fuel can cause a recoverable failure. Blowing helps only eligible warm targets, expires, and cannot stack beyond its cap.
- All tools spend their own resources once, have finite effects, and cannot create free heat by cancelling, pausing, or switching tools.
- Starter fluid is rejected on burning, warm, or actively igniting piles, including an action queued just before conditions change.
- Every visible small fuel flame follows fuel state; all large-log ends stay closed and logs remain supported through placement and collapse.
- Supports changing at accelerated burn speed preserve deterministic gameplay while visual drops, embers, and audio retain natural motion and one event per impact.
- Core heat, moisture, inventory, and unavailable-action reasons are legible on mobile and accessible by keyboard and screen reader.
- Reset, pause, mute, navigation, and background-tab suspension leave no stale input, duplicate sounds, resource duplication, or time jump.
