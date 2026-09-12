# Fire behavior and simulation notes

This pass uses the supplied ember photograph as a visual reference: broad red/orange incandescent charcoal plates, dark fissures, cooler projecting wood, and clear space above parts of the coal bed. The photograph is a reference only; no image assets were copied into the application.

## Physical observations

Wood first heats and dries, then releases combustible gases through pyrolysis. Oxidation of the remaining solid char can sustain a glow after those gas flames subside. This supports separate signals for heat release, surface incandescence, and visible gas instead of treating flame height as the temperature of the entire log. [US Forest Service, Thermal properties](https://research.fs.usda.gov/treesearch/22046).

Growing char also insulates the wood beneath it and reduces the supply of volatiles. Fresh exposed wood can therefore add visible flame to an already hot, charred fire. Temperature alone does not determine whether a wood fire has large orange flames; fuel supply and mixing matter too. The simulation's clear mature core is an artistic approximation of these transitions. [US Forest Service, Pyrolytic properties, section 3.4](https://www.fpl.fs.usda.gov/documnts/misc/em7700_8--entire-publication.pdf).

Flame flicker is associated with buoyancy-induced vortices interacting with the reaction zone. The rendering uses upward advection and slowly changing shared eddies to suggest this, with independent source variation rather than making the whole flame sway along a few synchronized sine waves. The cited experiment uses methane diffusion flames; its flow mechanism informs the rendering, not a calibrated wood-fire frequency. [NIST, Flow Characterization of Flickering Methane/Air Diffusion Flames](https://www.nist.gov/publications/flow-characterization-flickering-methaneair-diffusion-flames-using-particle-image).

## Implemented model

- Each log has five axial bands and eight circumferential regions. Fuel, moisture, char and heat remain attached to the wood as it moves. Fire exposure depends on position, distance from the coal core, orientation and nearby burning pieces. A rolled-away piece cools gradually and can retain unburned wood.
- The material and volumetric contact flames sample one shared thermal atlas. Char glows across irregular plate interiors with dark recessed fissures. A hot face remains the same physical face when the log rolls. New fuel replaces the old atlas state when a slot is reused.
- Logs use fixed 1/120-second real-time rigid-body steps, linear and angular impulses, contact friction, low restitution and sleeping. Every pair can exchange momentum regardless of arrival order. Ground contacts sample the same shape profiles used by the meshes, including rectangular lumber and flared stumps.
- Each stone has a fixed convex collider sampled from its rendered shape. Log and fragment contacts resolve against the individual stones with zero stone motion, including their side faces and tops. Gaps remain open instead of using a solid invisible circular wall.
- The mouse poker raycasts visible opaque surfaces, so a nearer rock blocks a poke at wood behind it. A bounded impulse at the clicked surface wakes that piece and its supported stack; an off-center push also turns it. Holding repeats at most once per 0.18 real animation seconds, independent of burn speed, and pause stops interaction.
- Small decorative forked twigs collapse inward as whole pieces, then settle against the sampled terrain. Their attached sparks and flame jackets follow the same transform. Their collapse is an art-directed transition rather than another full rigid-body pile.
- Weakened char accumulates damage under load. A shell failure removes existing char, deepens a persistent notch, and releases a bounded physical chunk that collides with logs and terrain. Mesh deformation and collision samples use the same notch profile. This is shell breakage and crumbling; it does not split a whole trunk into two fully simulated trunks.
- Flame volumes have round cross sections, rising three-dimensional detail, and bounds that follow active sources beyond the original pit. Thin surface ribbon cards are suppressed in the two living studies. Mature hot char produces less luminous gas; fresh volatile-rich wood restores stronger flames.
- The coal bed uses 76 angular, chipped pieces concentrated in the center. Each retains its own heat according to core exposure and neighboring coals; isolated pieces lose their glow more quickly. Small, independently phased variations move over the coal faces without making the entire bed pulse.
- Gray ash accumulates directly on the existing ground material, replacing 750 individual ash instances. Its coverage persists as logs move or fuel slots are reused. A 64 × 64 heat texture, refreshed at most five times per real second, warms the ash immediately around hot coals and fades as they cool. Ash growth changes no geometry and adds no draw calls.

The model remains deliberately reduced: normalized thermal units, coarse surface cells, approximate convex wood and stone contacts, sampled terrain, and a maximum of twelve solid char fragments. It is not a CFD solver or a calibrated structural fire model.

## Verification

Regression coverage includes deterministic accelerated combustion; finite patch fuel; axial and circumferential charring; material heat memory through rolling; position-dependent ignition and cooling; stable stacks; support loss; outward and downhill rolling; symmetric impacts; thin-piece tunneling; fracture mass; sealed damaged geometry; reset and replacement; finite shader uniforms; volumetric bounds and motion continuity. Browser checks exercise both living studies, close-up views, camera orbiting, additions, accelerated burning and actual WebGL shader compilation.
