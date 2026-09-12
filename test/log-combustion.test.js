import test from 'node:test';
import assert from 'node:assert/strict';
import { BurnCycle } from '../src/lifecycle.js';
import { combustionEnvironment, copyCombustionPose, removeCharFromSurface, sampleLogFlameBand, sampleLogSurface, surfaceExposure, updateLogSurface } from '../src/log-combustion.js';
import { getFuelType } from '../src/fuel-types.js';
import { groundHeight } from '../src/ground.js';

const poseAt = (x = 0, roll = 0) => ({ a: [x-1.4,.34,0], b: [x+1.4,.34,0], radius: .24,
  // Local +Y points along world +X; rolling swaps the two physical bark faces.
  sectionX: [0,-Math.cos(roll),-Math.sin(roll)], sectionZ: [0,-Math.sin(roll),Math.cos(roll)] });
const liveLog = (x = 0) => {
  const cycle = new BurnCycle(12); cycle.setAutoFeed(false);
  for (const log of cycle.logs) { log.phase = 'queued'; log.flame = 0; }
  const log = cycle.logs[0];
  Object.assign(log, { phase: 'fresh', wood: 1, char: 0, temperature: .025, moisture: .015,
    initialMoisture: .015, flame: 0, addedAt: 0, everLit: false, density: 1 });
  cycle.coalHeat = .9; cycle.coalMass = .8; cycle.setLogPoses([poseAt(x)]);
  cycle.updateSummary();
  return { cycle, log };
};
const mean = (patches, field) => patches.reduce((n,p) => n+p[field],0)/patches.length;
const near = (a,b,tolerance=1e-9) => assert.ok(Math.abs(a-b)<tolerance, `${a} ≈ ${b}`);

test('the starting fire already carries localized char history while queued wood stays intact', () => {
  const cycle = new BurnCycle(8108);
  for(const log of cycle.logs) {
    const patches = log.surface.patches;
    near(mean(patches,'wood'),log.wood); near(mean(patches,'char'),log.char);
    if(log.phase==='queued') {
      assert.ok(patches.every(p=>p.wood===1 && p.char===0 && p.flame===0 && p.glow===0));
    } else {
      assert.ok(Math.max(...patches.map(p=>p.temperature))-Math.min(...patches.map(p=>p.temperature))>.35);
      assert.ok(Math.max(...patches.map(p=>p.wood))-Math.min(...patches.map(p=>p.wood))>.25);
      assert.ok(log.visibleFlame<log.flame);
    }
  }
});

test('surface exposure distinguishes the core, projecting ends, and the underside', () => {
  const pose = copyCombustionPose(poseAt());
  const center = surfaceExposure(pose,.5,0), end = surfaceExposure(pose,.05,0), top = surfaceExposure(pose,.5,Math.PI);
  assert.ok(center.exposure > end.exposure*2);
  assert.ok(center.exposure > top.exposure*1.2);
  assert.ok(surfaceExposure(copyCombustionPose(poseAt(5)),.5,0).exposure < .0001);
});

const heatedSurface = (fuelType, height = .12) => {
  const fuel = getFuelType(fuelType);
  const log = { slot: 0, id: 1, fuelType, scale: 1, angle: 0, offset: 0, wood: .92, char: .08,
    moisture: 0, temperature: .025, flame: 1, addedAt: 0, everLit: true };
  // Broad board faces point down/up. A circular log shares the same basis.
  const pose = copyCombustionPose({ a: [-1,height,0], b: [1,height,0], radius: .25 * fuel.radiusScale,
    sectionX: [0,0,1], sectionZ: [0,-1,0], fuelType });
  combustionEnvironment(log, pose);
  log.temperature = .95;
  for (let step = 0; step < 360; step++) updateLogSurface(log, .5, fuel, { consumed: 0, dry: 0, charBurn: 0, shed: 0, coreHeat: 1 });
  return log;
};

test('logs resting in the excavated bowl heat and glow underneath while their crown stays sheltered', () => {
  const log = heatedSurface('log', groundHeight(0,0) + .25);
  const lower = sampleLogSurface(log,.5,Math.PI*.5), upper = sampleLogSurface(log,.5,Math.PI*1.5);
  assert.ok(lower.exposure > upper.exposure * 6);
  assert.ok(lower.temperature > .9 && upper.temperature < .4);
  assert.ok(lower.glow > upper.glow * 8);
  assert.ok(sampleLogFlameBand(log,.5) > .65, 'gas released below the wood still feeds a rising flame');
});

test('board exposure intersects flat faces and thin pallet pieces conduct heat through to their upper face', () => {
  const fuelType = 'pallet', radius = .25 * getFuelType(fuelType).radiusScale;
  const pose = copyCombustionPose({ a: [-1,.12,0], b: [1,.12,0], radius, fuelType,
    sectionX: [0,0,1], sectionZ: [0,-1,0] });
  const halfDepth = radius / Math.hypot(getFuelType(fuelType).aspect, 1);
  near(surfaceExposure(pose,.5,Math.PI*.5).point[1],.12-halfDepth);
  near(surfaceExposure(pose,.5,Math.PI*.25).point[1],.12-halfDepth);
  near(surfaceExposure(pose,.5,Math.PI*1.5).point[1],.12+halfDepth);
  const round = heatedSurface('log'), board = heatedSurface('plank'), thin = heatedSurface('pallet');
  const top = log => sampleLogSurface(log,.5,Math.PI*1.5).temperature;
  assert.ok(top(round) < .4 && top(board) < .6);
  assert.ok(top(thin) > .75 && top(thin) > top(board) + .2);
  for (const log of [round,board,thin]) {
    near(mean(log.surface.patches,'wood'),log.wood);
    near(mean(log.surface.patches,'char'),log.char);
  }
});

test('bark variation is deterministic, differs between pieces, and stays attached when they roll', () => {
  const first = liveLog(), same = liveLog();
  const material = first.log.surface.patches.map(p=>p.reactivity);
  assert.deepEqual(material,same.log.surface.patches.map(p=>p.reactivity));
  assert.ok(Math.max(...material)-Math.min(...material) > .5);
  const next = same.cycle.logs[1];
  assert.notDeepEqual(material,next.surface.patches.map(p=>p.reactivity));
  first.cycle.advance(60); first.cycle.setLogPoses([poseAt(0,Math.PI)]); first.cycle.advance(.5);
  assert.deepEqual(material,first.log.surface.patches.map(p=>p.reactivity));
});

test('rising flame sampling is continuous along the wood and independent of its material roll', () => {
  const { cycle,log } = liveLog(); cycle.advance(60);
  const before = sampleLogFlameBand(log,.42);
  near(sampleLogFlameBand(log,.42-1e-8),sampleLogFlameBand(log,.42+1e-8),1e-7);
  // Rotate the material cells by half a turn without changing released gas.
  for (let row=0;row<5;row++) {
    const flames=log.surface.patches.slice(row*8,row*8+8).map(p=>p.flame);
    for(let side=0;side<8;side++)log.surface.patches[row*8+side].flame=flames[(side+4)%8];
  }
  near(sampleLogFlameBand(log,.42),before);
  assert.ok(before>0 && before<=1);
});

test('cached exposure responds to a mutable caller pose without rebasing material history', () => {
  const { cycle,log } = liveLog(); cycle.advance(60);
  const pose = copyCombustionPose(poseAt());
  combustionEnvironment(log,pose);
  const patches = log.surface.patches, history = patches.map(p=>[p.wood,p.char,p.temperature]);
  const coupling = log.surface.bedCoupling;
  pose.a[0] += 6; pose.b[0] += 6;
  combustionEnvironment(log,pose);
  assert.ok(log.surface.bedCoupling < coupling*.0001);
  assert.deepEqual(patches.map(p=>[p.wood,p.char,p.temperature]),history);
  assert.ok(patches.every(p=>p.position[0]>4));
});

test('a log chars locally along its length and around its circumference with conserved finite fuel', () => {
  const { cycle, log } = liveLog();
  for(let second=0;second<160;second++) {
    cycle.advance(1);
    for(const field of ['wood','char','moisture']) near(mean(log.surface.patches,field),log[field]);
    for(const patch of log.surface.patches) for(const field of ['wood','char','moisture','temperature','flame','glow']) {
      assert.ok(Number.isFinite(patch[field]) && patch[field]>=0,field);
    }
  }
  assert.equal(log.surface.axial,5); assert.equal(log.surface.radial,8); assert.equal(log.surface.patches.length,40);
  const center = sampleLogSurface(log,.5,0), end = sampleLogSurface(log,.1,0), top = sampleLogSurface(log,.5,Math.PI);
  assert.ok(center.wood < end.wood-.2);
  assert.ok(center.wood < top.wood-.08);
  assert.ok(center.char > end.char);
  assert.ok(center.glow > end.glow*2);
});

test('a hot charred underside keeps venting interior wood gas through two to five minutes of burning', () => {
  const { cycle,log } = liveLog(); cycle.advance(120);
  for(let time=120;time<=300;time+=30) {
    const lower = sampleLogSurface(log,.5,0), upper = sampleLogSurface(log,.5,Math.PI);
    assert.ok(log.flame>.8 && log.visibleFlame>log.flame*.25, `visible fire survives at ${time}s`);
    assert.ok(lower.wood<.01 && lower.flame>log.flame*.3, 'a depleted surface cell still vents the burning interior');
    assert.ok(upper.glow<.02 && upper.wood>log.wood+.1, 'rising gas does not paint embers onto the sheltered crown');
    if(time<300)cycle.advance(30);
  }
});

test('rolling changes the exposed face without rotating or resetting material heat and char', () => {
  const { cycle, log } = liveLog(); cycle.advance(100);
  const before = sampleLogSurface(log,.1,0), previousTop = sampleLogSurface(log,.1,Math.PI);
  cycle.setLogPoses([poseAt(0,Math.PI)]); cycle.advance(.5);
  const after = sampleLogSurface(log,.1,0), newUnder = sampleLogSurface(log,.1,Math.PI);
  near(after.exposure,previousTop.exposure);
  near(newUnder.exposure,before.exposure);
  assert.ok(Math.abs(after.temperature-before.temperature)<.03);
  assert.ok(Math.abs(after.wood-before.wood)<.01);
  assert.ok(after.temperature>newUnder.temperature, 'previously exposed bark remains warmer immediately after rolling');
  cycle.advance(100);
  assert.ok(sampleLogSurface(log,.1,Math.PI).temperature>sampleLogSurface(log,.1,0).temperature);
});

test('fuel rolled off the fire cools with memory, stops flaming, and retains unburned wood', () => {
  const { cycle, log } = liveLog(); cycle.advance(150);
  const temperature = log.temperature, wood = log.wood;
  cycle.setLogPoses([poseAt(6)]); cycle.advance(.5);
  assert.ok(log.temperature > temperature*.95);
  assert.ok(Math.max(...log.surface.patches.map(p=>p.temperature))>.8);
  cycle.advance(240);
  assert.ok(log.temperature<.02); assert.equal(log.flame,0); assert.equal(log.visibleFlame,0);
  assert.equal(log.glow,0); assert.ok(log.wood>.5 && log.wood<wood);
  const remaining = log.wood; cycle.advance(240); near(log.wood,remaining);
});

test('actual spatial proximity governs ignition instead of a reusable slot number', () => {
  const nearFire = liveLog(), away = liveLog(5);
  nearFire.cycle.advance(180); away.cycle.advance(180);
  assert.equal(nearFire.log.everLit,true); assert.equal(away.log.everLit,false);
  assert.equal(away.log.wood,1); assert.ok(away.log.temperature<.01);
  assert.ok(nearFire.log.wood<.8);
  assert.ok(nearFire.cycle.coalHeat>away.cycle.coalHeat);
});

test('hot mature char glows while luminous gas falls, and fresh hot wood renews the flames', () => {
  const charred = liveLog(), fresh = liveLog();
  Object.assign(charred.log,{wood:.045,char:.2,temperature:.98,moisture:0,flame:.85,everLit:true,phase:'charred'});
  Object.assign(fresh.log,{wood:.95,char:.02,temperature:.98,moisture:0,flame:.85,everLit:true,phase:'burning'});
  for(const sample of [charred,fresh]) sample.cycle.advance(8);
  assert.ok(charred.log.glow>.65);
  assert.ok(charred.log.visibleFlame<fresh.log.visibleFlame*.25);
  assert.ok(charred.log.visibleFlame<charred.log.flame*.25);
  assert.ok(fresh.log.visibleFlame>.65);
});

test('fracture removes only existing char from its own material zone and preserves thermal history', () => {
  const { cycle,log } = liveLog(); cycle.advance(180);
  const patches = log.surface.patches, before = patches.map(p=>({...p})), char = log.char;
  const removed = removeCharFromSurface(log,.012,.5);
  assert.ok(removed>0 && removed<=.012+1e-12); near(log.char,char-removed);
  near(mean(patches,'char'),log.char);
  assert.ok(before[16].char-patches[16].char>before[0].char-patches[0].char);
  assert.deepEqual(patches.map(p=>p.temperature),before.map(p=>p.temperature));
  const remaining = log.char, rest = removeCharFromSurface(log,10); near(rest,remaining); near(log.char,0);
  assert.ok(patches.every(p=>p.char===0));
});

test('pose snapshots are detached from physics, invalid inputs fall back, and angular interpolation is seamless', () => {
  const { cycle,log } = liveLog(); const pose = poseAt(); cycle.setLogPoses([pose]);
  pose.a[0]=100; assert.equal(cycle.logPoses[0].a[0],-1.4);
  cycle.advance(100);
  const a = sampleLogSurface(log,.5,-.000001), b = sampleLogSurface(log,.5,Math.PI*2-.000001);
  for(const key of Object.keys(a)) near(a[key],b[key]);
  cycle.setLogPoses([{a:[NaN,0,0],b:[1,0,0],radius:1}]); cycle.advance(1);
  assert.equal(cycle.logPoses[0],null); assert.ok(Number.isFinite(log.temperature));
});

test('detached char remains in the fuel and afterglow summary without heating the central bed', () => {
  const cycle=new BurnCycle(42);
  for(const log of cycle.logs)Object.assign(log,{phase:'ash',wood:0,char:0,flame:0,temperature:0});
  cycle.coalHeat=0;cycle.fragmentChar=.045;cycle.fragmentHeat=.8;cycle.updateSummary();
  near(cycle.fuel,.045);assert.equal(cycle.phase,'Ember afterglow');assert.equal(cycle.coreHeat,0);assert.equal(cycle.coreStatus,'Cold');
  cycle.fragmentChar=0;cycle.fragmentHeat=0;cycle.updateSummary();
  assert.equal(cycle.fuel,0);assert.equal(cycle.phase,'Cold fire bed');
  cycle.fragmentChar=.1;cycle.fragmentHeat=.9;cycle.reset(42);
  assert.equal(cycle.fragmentChar,0);assert.equal(cycle.fragmentHeat,0);
});
