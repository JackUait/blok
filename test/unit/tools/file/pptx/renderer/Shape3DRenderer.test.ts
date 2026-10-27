// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import '../helpers/domShims';
import { parseXml } from '../../../../../../src/tools/file/pptx/parser/XmlParser';
import { parseShapeNode } from '../../../../../../src/tools/file/pptx/model/nodes/ShapeNode';
import {
  applyStaticGroup3DPlane,
  appendStaticShape3DEffects,
  buildStaticGroup3DPlan,
  buildStaticShape3DPlan,
  solidBevelShadowStrength,
} from '../../../../../../src/tools/file/pptx/renderer/Shape3DRenderer';
import { createMockRenderContext } from '../helpers/mockContext';

type ShapeTarget = Parameters<typeof buildStaticShape3DPlan>[1];
type GroupTarget = Parameters<typeof buildStaticGroup3DPlan>[1];

function parseShape3D(sceneXml: string, shapeXml: string, extraShapeProperties = '') {
  const xml = `
    <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:nvSpPr><p:cNvPr id="1" name="3D probe"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="952500"/></a:xfrm>
        <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
        ${extraShapeProperties}
        ${sceneXml}
        ${shapeXml}
      </p:spPr>
    </p:sp>`;
  return parseShapeNode(parseXml(xml)).shape3d;
}

const supportedScene = `
  <a:scene3d>
    <a:camera prst="orthographicFront"/>
    <a:lightRig rig="threePt" dir="t"/>
  </a:scene3d>`;

const supportedShape = `
  <a:sp3d contourW="12700">
    <a:bevelT w="127000" h="127000" prst="circle"/>
    <a:contourClr><a:srgbClr val="FFFFFF"/></a:contourClr>
  </a:sp3d>`;

const cameraOnlyShape = `<a:sp3d extrusionH="0"/>`;

const perspectiveCameraScene = `
  <a:scene3d>
    <a:camera prst="perspectiveRelaxedModerately" fov="7200000">
      <a:rot lat="18590633" lon="0" rev="0"/>
    </a:camera>
    <a:lightRig rig="threePt" dir="t"/>
  </a:scene3d>`;

const perspectiveTextCameraScene = `
  <a:scene3d>
    <a:camera prst="perspectiveContrastingRightFacing" fov="5100000">
      <a:rot lat="0" lon="19532225" rev="0"/>
    </a:camera>
    <a:lightRig rig="threePt" dir="t"/>
  </a:scene3d>`;

const perspectiveLeftTextCameraScene = `
  <a:scene3d>
    <a:camera prst="perspectiveLeft" fov="7200000"/>
    <a:lightRig rig="threePt" dir="t"/>
  </a:scene3d>`;

const perspectiveRightPictureCameraScene = `
  <a:scene3d>
    <a:camera prst="perspectiveRight" fov="5700000"/>
    <a:lightRig rig="threePt" dir="t"/>
  </a:scene3d>`;

const perspectiveLeftPictureGroupScene = `
  <a:scene3d>
    <a:camera prst="perspectiveLeft" fov="5700000">
      <a:rot lat="0" lon="1500000" rev="0"/>
    </a:camera>
    <a:lightRig rig="threePt" dir="t"/>
  </a:scene3d>`;

const bottomBevelFrontScene = `
  <a:scene3d>
    <a:camera prst="orthographicFront"/>
    <a:lightRig rig="threePt" dir="t">
      <a:rot lat="0" lon="0" rev="3000000"/>
    </a:lightRig>
  </a:scene3d>`;

const bottomRelaxedInsetDkEdge = `
  <a:sp3d prstMaterial="dkEdge">
    <a:bevelB prst="relaxedInset"/>
  </a:sp3d>`;

const originalImageDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalImageDecode) {
    Object.defineProperty(HTMLImageElement.prototype, 'decode', originalImageDecode);
  } else {
    delete (HTMLImageElement.prototype as Partial<HTMLImageElement>).decode;
  }
});

describe('bounded group camera planner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const target = {
    width: 190.58194225721786,
    height: 68.32419947506562,
    childKinds: ['pic', 'pic'] as const,
    hasSupportedPictureChildren: true,
    hasValidChildCoordinateSpace: true,
    container: 'group' as const,
    hasTransformedAncestor: false,
    hasSceneAncestor: false,
    rotation: 0,
    flipH: false,
    flipV: false,
  };

  it('builds the native-backed perspective-left plan inside coordinate-only ancestor groups', () => {
    const plan = buildStaticGroup3DPlan(
      parseShape3D(perspectiveLeftPictureGroupScene, ''),
      target,
      createMockRenderContext({
        presentation: { ...createMockRenderContext().presentation, width: 1280 },
      }),
    );

    expect(plan).toMatchObject({
      mode: 'camera-projected-group-plane',
      surface: 'group',
      geometry: 'rect',
      camera: {
        kind: 'perspective',
        preset: 'perspectiveLeft',
        rotation: { latitude: 0, longitude: 25, revolution: 0 },
        fieldOfView: 95,
      },
      lighting: { color: '#FFFFFF', opacity: 0.02 },
    });
    if (plan.mode !== 'camera-projected-group-plane') throw new Error('expected group plan');
    expect(plan.corners[0].x).toBeGreaterThan(10);
    expect(plan.corners[1].x).toBeGreaterThan(180);
    expect(plan.lighting.brightness).toBeCloseTo(1.0402, 3);
  });

  it('uses native aspect anchors for whole-group picture lighting', () => {
    const properties = parseShape3D(perspectiveLeftPictureGroupScene, '');
    const context = createMockRenderContext();
    const brightness = [
      buildStaticGroup3DPlan(properties, { ...target, width: 307.2, height: 518.4 }, context),
      buildStaticGroup3DPlan(properties, { ...target, width: 403.2, height: 403.2 }, context),
      buildStaticGroup3DPlan(properties, { ...target, width: 768, height: 307.2 }, context),
    ].map((plan) =>
      plan.mode === 'camera-projected-group-plane' ? plan.lighting.brightness : NaN,
    );

    expect(brightness[0]).toBeGreaterThan(brightness[1]);
    expect(brightness[1]).toBeGreaterThan(brightness[2]);
    expect(brightness).toEqual([
      expect.closeTo(1.089, 3),
      expect.closeTo(1.0725, 4),
      expect.closeTo(1.0436, 3),
    ]);
  });

  it.each<[string, string, GroupTarget & { hasGroupEffects?: boolean }]>([
    [
      'camera-field-of-view',
      perspectiveLeftPictureGroupScene.replace('5700000', '5760000'),
      target,
    ],
    ['camera-rotation', perspectiveLeftPictureGroupScene.replace('1500000', '1440000'), target],
    [
      'parent-container',
      perspectiveLeftPictureGroupScene,
      { ...target, hasTransformedAncestor: true },
    ],
    ['parent-container', perspectiveLeftPictureGroupScene, { ...target, hasSceneAncestor: true }],
    ['group-child-profile', perspectiveLeftPictureGroupScene, { ...target, childKinds: ['pic'] }],
    [
      'group-child-profile',
      perspectiveLeftPictureGroupScene,
      { ...target, hasSupportedPictureChildren: false },
    ],
    [
      'group-child-profile',
      perspectiveLeftPictureGroupScene,
      { ...target, hasValidChildCoordinateSpace: false },
    ],
    [
      'backdrop',
      perspectiveLeftPictureGroupScene.replace('</a:scene3d>', '<a:backdrop/></a:scene3d>'),
      target,
    ],
    [
      'effect-list-conflict',
      perspectiveLeftPictureGroupScene,
      { ...target, hasGroupEffects: true },
    ],
    ['shape-transform', perspectiveLeftPictureGroupScene, { ...target, rotation: 1 }],
  ])('keeps a diagnostic flat fallback for %s', (reason, scene, candidate) => {
    const properties = parseShape3D(
      scene,
      '',
      candidate.hasGroupEffects ? '<a:effectLst><a:outerShdw blurRad="12700"/></a:effectLst>' : '',
    );
    const { hasGroupEffects: _ignored, ...plannerTarget } = candidate;
    expect(buildStaticGroup3DPlan(properties, plannerTarget, createMockRenderContext())).toEqual({
      mode: 'flat',
      reason,
    });
  });

  it('applies the group homography once to a live child layer', () => {
    const plan = buildStaticGroup3DPlan(
      parseShape3D(perspectiveLeftPictureGroupScene, ''),
      target,
      createMockRenderContext(),
    );
    const layer = document.createElement('div');

    expect(applyStaticGroup3DPlane(layer, plan)).toBe(true);
    expect(layer.dataset.pptxShape3dProjectedGroupPlane).toBe('perspective');
    expect(layer.style.transformOrigin).toBe('0px 0px');
    expect(layer.style.transform).toMatch(/^matrix3d\(/);
    expect(applyStaticGroup3DPlane(layer, plan)).toBe(false);
  });
});

function installShape3DRasterMocks() {
  vi.stubGlobal(
    'Path2D',
    class MockPath2D {
      constructor(readonly path: string) {}
    },
  );

  const maskContext = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
      return { data, width, height } as ImageData;
    }),
  };
  const outputContext = {
    createImageData: vi.fn((width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    })),
    putImageData: vi.fn(),
  };
  let contextCount = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    contextCount += 1;
    return (contextCount === 1 ? maskContext : outputContext) as never;
  });
  let completeBlob: BlobCallback | undefined;
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    completeBlob = callback;
  });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });

  return {
    maskContext,
    outputContext,
    toBlob,
    complete(blob: Blob | null) {
      if (!completeBlob) throw new Error('toBlob callback was not registered');
      completeBlob(blob);
    },
  };
}

describe('buildStaticShape3DPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the native-backed square bevel shadow response for each geometry', () => {
    expect(solidBevelShadowStrength(200, 200, 'rect', 8)).toBeCloseTo(0.7, 5);
    expect(solidBevelShadowStrength(200, 200, 'rect', 40 / 3)).toBeCloseTo(0.58, 5);
    expect(solidBevelShadowStrength(200, 200, 'roundrect', 8)).toBeCloseTo(0.58, 5);
    // oracle-pypptx-shape3d-0012 slides 0/2: the generic 0.58 response makes the
    // square donut dark band 1.01-1.02x stronger than PowerPoint.
    expect(solidBevelShadowStrength(200, 200, 'donut', 8)).toBeCloseTo(0.572, 5);
  });

  it('uses the native-backed weaker shadow response for wide non-rounded surfaces', () => {
    expect(solidBevelShadowStrength(500, 200, 'rect', 40 / 3)).toBeCloseTo(0.415, 5);
    expect(solidBevelShadowStrength(500, 200, 'ellipse', 40 / 3)).toBeCloseTo(0.415, 5);
    expect(solidBevelShadowStrength(500, 200, 'donut', 40 / 3)).toBeCloseTo(0.382, 5);
    expect(solidBevelShadowStrength(500, 200, 'roundrect', 8)).toBeCloseTo(0.45, 5);
  });

  it('uses the native-backed weaker shadow response for a tall rectangular surface', () => {
    expect(solidBevelShadowStrength(93.75, 200, 'rect', 40 / 3)).toBeCloseTo(0.646, 5);
    expect(solidBevelShadowStrength(93.75, 200, 'ellipse', 40 / 3)).toBeCloseTo(0.72, 5);
  });

  it('builds the native-backed flat-plane perspective camera plan', () => {
    const ctx = createMockRenderContext({
      presentation: {
        ...createMockRenderContext().presentation,
        width: 1280,
        height: 720,
      },
    });
    const plan = buildStaticShape3DPlan(
      parseShape3D(perspectiveCameraScene, cameraOnlyShape),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 403.2,
        height: 403.2,
        paintKind: 'solid',
        baseFill: '#2F75B5',
        hasVisibleStroke: false,
        hasVisibleText: false,
        rotation: 0,
        flipH: false,
        flipV: false,
      },
      ctx,
    );

    expect(plan).toMatchObject({
      mode: 'camera-projected-plane',
      surface: 'shape',
      geometry: 'rect',
      camera: {
        kind: 'perspective',
        preset: 'perspectiveRelaxedModerately',
        fieldOfView: 120,
      },
      fill: { top: '#4b94d6', bottom: '#3c85c7' },
    });
    if (plan.mode !== 'camera-projected-plane') throw new Error('expected camera plan');
    expect(plan.corners[0].x).toBeCloseTo(62.3, 1);
    expect(plan.corners[2].x).toBeCloseTo(560.8, 1);
  });

  it('treats an absent sp3d as the verified zero-depth solid camera plane', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(perspectiveCameraScene, ''),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 403.2,
        height: 403.2,
        paintKind: 'solid',
        baseFill: '#2F75B5',
        hasVisibleStroke: false,
        hasVisibleText: false,
      },
      createMockRenderContext({
        presentation: { ...createMockRenderContext().presentation, width: 1280, height: 720 },
      }),
    );

    expect(plan).toMatchObject({
      mode: 'camera-projected-plane',
      camera: { preset: 'perspectiveRelaxedModerately' },
      fill: { top: '#4b94d6', middle: '#438bce', bottom: '#3c85c7' },
    });
  });

  it.each([
    ['wide', 768, 307.2, { top: '#4089cb', middle: '#3c85c7', bottom: '#367ec1' }],
    ['tall', 307.2, 518.4, { top: '#4992d4', middle: '#3d86c8', bottom: '#3780c2' }],
  ])(
    'uses the native scene-only material field for the %s aspect',
    (_label, width, height, fill) => {
      const plan = buildStaticShape3DPlan(
        parseShape3D(perspectiveCameraScene, ''),
        {
          nodeType: 'shape',
          presetGeometry: 'rect',
          width,
          height,
          paintKind: 'solid',
          baseFill: '#2F75B5',
          hasVisibleStroke: false,
          hasVisibleText: false,
        },
        createMockRenderContext({
          presentation: { ...createMockRenderContext().presentation, width: 1280, height: 720 },
        }),
      );

      expect(plan).toMatchObject({ mode: 'camera-projected-plane', fill });
    },
  );

  it.each([
    ['Office blue', '#2F75B5', { top: '#4b94d6', middle: '#438bce', bottom: '#3c85c7' }],
    ['white', '#FFFFFF', { top: '#ffffff', bottom: '#ffffff' }],
  ])(
    'builds the bounded multi-contour cubic custom camera plane with %s paint',
    (_label, baseFill, fill) => {
      const plan = buildStaticShape3DPlan(
        parseShape3D(perspectiveCameraScene, ''),
        {
          nodeType: 'shape',
          width: 403.2,
          height: 403.2,
          paintKind: 'solid',
          baseFill,
          hasVisibleStroke: false,
          hasVisibleText: false,
          hasCustomGeometry: true,
          customGeometryProfile: 'multi-contour-cubic',
          container: 'standalone-slide',
          hasStyleReference: false,
        },
        createMockRenderContext({
          presentation: { ...createMockRenderContext().presentation, width: 1280, height: 720 },
        }),
      );

      expect(plan).toMatchObject({
        mode: 'camera-projected-plane',
        geometry: 'custom',
        camera: { preset: 'perspectiveRelaxedModerately' },
        fill,
      });
      if (plan.mode !== 'camera-projected-plane') throw new Error('expected custom camera plan');
      expect(plan.corners[0].x).toBeCloseTo(41.0, 1);
      expect(plan.corners[0].y).toBeCloseTo(98.7, 1);
      expect(plan.corners[2].x).toBeCloseTo(559.8, 1);
      expect(plan.corners[2].y).toBeCloseTo(431.1, 1);
    },
  );

  it.each<[string, Partial<ShapeTarget>, string]>([
    // 'other' is outside the declared profile union on purpose.
    [
      'unclassified path commands',
      { customGeometryProfile: 'other' as string as ShapeTarget['customGeometryProfile'] },
      'geometry-preset',
    ],
    ['group container', { container: 'group' }, 'parent-container'],
    ['style reference', { hasStyleReference: true }, 'style-reference'],
    ['unverified physical extent', { width: 500 }, 'invalid-bounds'],
  ])('keeps a bounded custom camera plane with %s flat', (_label, patch, reason) => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(perspectiveCameraScene, ''),
      {
        nodeType: 'shape',
        width: 403.2,
        height: 403.2,
        paintKind: 'solid',
        baseFill: '#2F75B5',
        hasVisibleStroke: false,
        hasVisibleText: false,
        hasCustomGeometry: true,
        customGeometryProfile: 'multi-contour-cubic',
        container: 'standalone-slide',
        hasStyleReference: false,
        ...patch,
      },
      createMockRenderContext(),
    );

    expect(plan).toEqual({ mode: 'flat', reason });
  });

  it('builds the exact scene-only editable-text camera plane', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(perspectiveTextCameraScene, ''),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 441.6,
        height: 384,
        paintKind: 'none',
        hasVisibleStroke: false,
        hasVisibleText: true,
        textPlane: {
          wrap: 'none',
          anchor: 'ctr',
          autofit: 'spAutoFit',
        },
      },
      createMockRenderContext({
        presentation: { ...createMockRenderContext().presentation, width: 1280, height: 720 },
      }),
    );

    expect(plan).toMatchObject({
      mode: 'camera-projected-text-plane',
      camera: {
        kind: 'perspective',
        preset: 'perspectiveContrastingRightFacing',
        fieldOfView: 85,
      },
    });
    if (plan.mode !== 'camera-projected-text-plane') throw new Error('expected text plan');
    expect(plan.corners[0].x).toBeCloseTo(-3.5, 1);
    expect(plan.corners[3].y).toBeCloseTo(428.5, 1);
  });

  it('applies the perspective-left preset rotation to a top-anchored editable-text plane', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(perspectiveLeftTextCameraScene, ''),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 403.2,
        height: 403.2,
        paintKind: 'none',
        hasVisibleStroke: false,
        hasVisibleText: true,
        textPlane: {
          wrap: 'none',
          autofit: 'spAutoFit',
        },
      },
      createMockRenderContext({
        presentation: { ...createMockRenderContext().presentation, width: 1280, height: 720 },
      }),
    );

    expect(plan).toMatchObject({
      mode: 'camera-projected-text-plane',
      camera: {
        kind: 'perspective',
        preset: 'perspectiveLeft',
        rotation: { latitude: 0, longitude: 20, revolution: 0 },
        fieldOfView: 120,
      },
    });
    if (plan.mode !== 'camera-projected-text-plane') throw new Error('expected text plan');
    expect(plan.corners[0].x).toBeLessThan(plan.corners[1].x);
    expect(plan.corners[0].y).toBeGreaterThan(plan.corners[1].y);
  });

  it('builds the exact perspective-right picture plane with the preset implicit rotation', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(perspectiveRightPictureCameraScene, ''),
      {
        nodeType: 'picture',
        presetGeometry: 'rect',
        width: 403.2,
        height: 403.2,
        paintKind: 'picture',
        hasStretchMode: true,
        hasVisibleStroke: false,
        rotation: 0,
        flipH: false,
        flipV: false,
        sourceCrop: { left: 0.22, top: 0.18, right: 0.08, bottom: 0.12 },
      },
      createMockRenderContext({
        presentation: { ...createMockRenderContext().presentation, width: 1280, height: 720 },
      }),
    );

    expect(plan).toMatchObject({
      mode: 'camera-projected-picture-plane',
      surface: 'picture',
      geometry: 'rect',
      camera: {
        kind: 'perspective',
        preset: 'perspectiveRight',
        rotation: { latitude: 0, longitude: -20, revolution: 0 },
        fieldOfView: 95,
      },
      lighting: { brightness: 1.01, color: '#FFFFFF', opacity: 0.09 },
    });
    if (plan.mode !== 'camera-projected-picture-plane') throw new Error('expected picture plan');
    expect(plan.corners[0]).toEqual({ x: expect.closeTo(-14.6, 1), y: expect.closeTo(-28.5, 1) });
    expect(plan.corners[2]).toEqual({ x: expect.closeTo(370.2, 1), y: expect.closeTo(381, 1) });
  });

  it.each([
    [
      'explicit camera rotation',
      perspectiveRightPictureCameraScene.replace(
        '<a:camera prst="perspectiveRight" fov="5700000"/>',
        '<a:camera prst="perspectiveRight" fov="5700000"><a:rot lat="0" lon="-1200000" rev="0"/></a:camera>',
      ),
      '',
      { presetGeometry: 'rect' },
      'camera-rotation',
    ],
    [
      'different field of view',
      perspectiveRightPictureCameraScene.replace('5700000', '6000000'),
      '',
      { presetGeometry: 'rect' },
      'camera-field-of-view',
    ],
    [
      'shape format',
      perspectiveRightPictureCameraScene,
      '<a:sp3d extrusionH="0"/>',
      { presetGeometry: 'rect' },
      'picture-shape-format',
    ],
    [
      'nonrectangular geometry',
      perspectiveRightPictureCameraScene,
      '',
      { presetGeometry: 'roundRect' },
      'geometry-preset',
    ],
    [
      'visible outline',
      perspectiveRightPictureCameraScene,
      '',
      { presetGeometry: 'rect', hasVisibleStroke: true },
      'visible-stroke',
    ],
    [
      'picture transform',
      perspectiveRightPictureCameraScene,
      '',
      { presetGeometry: 'rect', rotation: 1 },
      'shape-transform',
    ],
    [
      'tile fill',
      perspectiveRightPictureCameraScene,
      '',
      { presetGeometry: 'rect', isTiledPicture: true },
      'tiled-picture',
    ],
    [
      'missing stretch mode',
      perspectiveRightPictureCameraScene,
      '',
      { presetGeometry: 'rect', hasStretchMode: false },
      'picture-stretch-mode',
    ],
    [
      'stretch fill rectangle',
      perspectiveRightPictureCameraScene,
      '',
      { presetGeometry: 'rect', hasStretchFillRect: true },
      'picture-fill-rect',
    ],
    [
      'blip effect',
      perspectiveRightPictureCameraScene,
      '',
      { presetGeometry: 'rect', hasBlipEffects: true },
      'picture-blip-effect',
    ],
    [
      'picture background fill',
      perspectiveRightPictureCameraScene,
      '',
      { presetGeometry: 'rect', hasPictureBackgroundFill: true },
      'paint-kind',
    ],
    [
      'custom geometry',
      perspectiveRightPictureCameraScene,
      '',
      { presetGeometry: 'rect', hasCustomGeometry: true },
      'geometry-preset',
    ],
    [
      'style reference',
      perspectiveRightPictureCameraScene,
      '',
      { presetGeometry: 'rect', hasStyleReference: true },
      'style-reference',
    ],
  ])(
    'keeps perspective-right picture planes with %s on a diagnostic flat fallback',
    (_label, scene, shape, targetPatch, reason) => {
      const plan = buildStaticShape3DPlan(
        parseShape3D(scene, shape),
        {
          nodeType: 'picture',
          width: 403.2,
          height: 403.2,
          paintKind: 'picture',
          hasStretchMode: true,
          hasVisibleStroke: false,
          rotation: 0,
          flipH: false,
          flipV: false,
          ...targetPatch,
        },
        createMockRenderContext(),
      );

      expect(plan).toEqual({ mode: 'flat', reason });
    },
  );

  it.each([
    [
      'explicit camera rotation',
      perspectiveLeftTextCameraScene.replace(
        '<a:camera prst="perspectiveLeft" fov="7200000"/>',
        '<a:camera prst="perspectiveLeft" fov="7200000"><a:rot lat="0" lon="1200000" rev="0"/></a:camera>',
      ),
      undefined,
      'camera-rotation',
    ],
    ['explicit center anchor', perspectiveLeftTextCameraScene, 'ctr', 'text-body-properties'],
  ])(
    'keeps perspective-left text with %s on the flat fallback',
    (_label, scene, anchor, reason) => {
      const plan = buildStaticShape3DPlan(
        parseShape3D(scene, ''),
        {
          nodeType: 'shape',
          presetGeometry: 'rect',
          width: 403.2,
          height: 403.2,
          paintKind: 'none',
          hasVisibleStroke: false,
          hasVisibleText: true,
          textPlane: { wrap: 'none', anchor, autofit: 'spAutoFit' },
        },
        createMockRenderContext(),
      );

      expect(plan).toEqual({ mode: 'flat', reason });
    },
  );

  it('keeps unverified scene-only text-body modes on the flat fallback', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(perspectiveTextCameraScene, ''),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 441.6,
        height: 384,
        paintKind: 'none',
        hasVisibleStroke: false,
        hasVisibleText: true,
        textPlane: {
          wrap: 'square',
          anchor: 'ctr',
          autofit: 'spAutoFit',
        },
      },
      createMockRenderContext(),
    );

    expect(plan).toEqual({ mode: 'flat', reason: 'text-body-properties' });
  });

  it('keeps styled scene-only text planes on the flat fallback', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(perspectiveTextCameraScene, ''),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 441.6,
        height: 384,
        paintKind: 'none',
        hasVisibleStroke: false,
        hasVisibleText: true,
        hasStyleReference: true,
        textPlane: {
          wrap: 'none',
          anchor: 'ctr',
          autofit: 'spAutoFit',
        },
      },
      createMockRenderContext(),
    );

    expect(plan).toEqual({ mode: 'flat', reason: 'style-reference' });
  });

  it('supports the identity control and the exact orthographic rotation tuple', () => {
    const ctx = createMockRenderContext();
    const target = {
      nodeType: 'shape' as const,
      presetGeometry: 'rect',
      width: 403.2,
      height: 403.2,
      paintKind: 'solid' as const,
      baseFill: '#2F75B5',
      hasVisibleStroke: false,
      hasVisibleText: false,
      rotation: 0,
      flipH: false,
      flipV: false,
    };
    const identity = buildStaticShape3DPlan(
      parseShape3D(
        '<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></a:scene3d>',
        cameraOnlyShape,
      ),
      target,
      ctx,
    );
    const rotated = buildStaticShape3DPlan(
      parseShape3D(
        '<a:scene3d><a:camera prst="orthographicFront"><a:rot lat="1200000" lon="1800000" rev="0"/></a:camera><a:lightRig rig="threePt" dir="t"/></a:scene3d>',
        cameraOnlyShape,
      ),
      target,
      ctx,
    );

    expect(identity).toMatchObject({
      mode: 'camera-projected-plane',
      camera: { kind: 'orthographic' },
      fill: { top: '#367fc1', bottom: '#367fc1' },
    });
    expect(rotated).toMatchObject({
      mode: 'camera-projected-plane',
      camera: { kind: 'orthographic' },
      fill: { top: '#317abc', bottom: '#317abc' },
    });
    expect(
      buildStaticShape3DPlan(
        parseShape3D(
          '<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></a:scene3d>',
          cameraOnlyShape,
        ),
        { ...target, baseFill: '#4F81BD' },
        ctx,
      ),
    ).toEqual({ mode: 'flat', reason: 'paint-value' });
  });

  it.each([
    [
      'dkEdge relaxedInset with live text',
      bottomBevelFrontScene,
      bottomRelaxedInsetDkEdge,
      576,
      288,
      true,
      '#4676cb',
      'dkEdge',
    ],
    [
      'implicit material with explicit default dimensions',
      bottomBevelFrontScene,
      '<a:sp3d><a:bevelB w="76200" h="76200" prst="relaxedInset"/></a:sp3d>',
      403.2,
      403.2,
      false,
      '#4b7bd0',
      'implicit',
    ],
    [
      'dkEdge circle tall neighbor without light rotation',
      '<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></a:scene3d>',
      '<a:sp3d prstMaterial="dkEdge"><a:bevelB prst="circle"/></a:sp3d>',
      307.2,
      499.2,
      false,
      '#4676cb',
      'dkEdge',
    ],
  ])(
    'builds the native-backed bottom-bevel front material plan for %s',
    (_label, scene, shape, width, height, hasVisibleText, color, material) => {
      const plan = buildStaticShape3DPlan(
        parseShape3D(scene, shape),
        {
          nodeType: 'shape',
          presetGeometry: 'rect',
          width,
          height,
          paintKind: 'solid',
          baseFill: '#4472C4',
          hasVisibleStroke: false,
          hasVisibleText,
          hasStyleReference: true,
          container: 'standalone-slide',
          textPlane: hasVisibleText
            ? {
                anchor: 'ctr',
                autofit: 'none',
              }
            : undefined,
        },
        createMockRenderContext(),
      );

      expect(plan).toMatchObject({
        mode: 'camera-projected-plane',
        camera: { kind: 'orthographic', preset: 'orthographicFront' },
        fill: { top: color, bottom: color },
        frontMaterial: material,
      });
    },
  );

  it.each<[string, string, string, Partial<ShapeTarget>, string]>([
    [
      'transparent solid paint',
      bottomBevelFrontScene,
      bottomRelaxedInsetDkEdge,
      { baseFill: undefined },
      'paint-kind',
    ],
    [
      'unverified source color',
      bottomBevelFrontScene,
      bottomRelaxedInsetDkEdge,
      { baseFill: '#2F75B5' },
      'paint-value',
    ],
    [
      'unverified aspect ratio',
      bottomBevelFrontScene,
      bottomRelaxedInsetDkEdge,
      { width: 450, height: 300 },
      'bottom-bevel',
    ],
    [
      'non-default bevel dimensions',
      bottomBevelFrontScene,
      '<a:sp3d prstMaterial="dkEdge"><a:bevelB w="152400" h="76200" prst="relaxedInset"/></a:sp3d>',
      {},
      'bottom-bevel',
    ],
    [
      'different preset material',
      bottomBevelFrontScene,
      '<a:sp3d prstMaterial="metal"><a:bevelB prst="relaxedInset"/></a:sp3d>',
      {},
      'preset-material',
    ],
    [
      'different light rotation',
      '<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"><a:rot lat="0" lon="0" rev="2940000"/></a:lightRig></a:scene3d>',
      bottomRelaxedInsetDkEdge,
      {},
      'light-rotation',
    ],
    [
      'different text body tuple',
      bottomBevelFrontScene,
      bottomRelaxedInsetDkEdge,
      { hasVisibleText: true, textPlane: { wrap: 'square', anchor: 'ctr', autofit: 'none' } },
      'text-body-properties',
    ],
    [
      'group parent',
      bottomBevelFrontScene,
      bottomRelaxedInsetDkEdge,
      { container: 'group' },
      'parent-container',
    ],
    [
      'placeholder parent',
      bottomBevelFrontScene,
      bottomRelaxedInsetDkEdge,
      { container: 'placeholder' },
      'parent-container',
    ],
  ])(
    'keeps %s outside the bottom-bevel front material slice',
    (_label, scene, shape, targetPatch, reason) => {
      const plan = buildStaticShape3DPlan(
        parseShape3D(scene, shape),
        {
          nodeType: 'shape',
          presetGeometry: 'rect',
          width: 576,
          height: 288,
          paintKind: 'solid',
          baseFill: '#4472C4',
          hasVisibleStroke: false,
          hasVisibleText: false,
          container: 'standalone-slide',
          ...targetPatch,
        },
        createMockRenderContext(),
      );

      expect(plan).toEqual({ mode: 'flat', reason });
    },
  );

  it.each<[string, Partial<ShapeTarget>, string]>([
    ['visible text', { hasVisibleText: true }, 'visible-text'],
    ['visible stroke', { hasVisibleStroke: true }, 'visible-stroke'],
    ['shape rotation', { rotation: 1 }, 'shape-transform'],
    ['shape flip', { flipH: true }, 'shape-transform'],
    ['gradient paint', { paintKind: 'gradient' }, 'paint-kind'],
    ['unverified solid paint', { baseFill: '#70AD47' }, 'paint-value'],
  ])('keeps a diagnostic fallback for camera projection with %s', (_label, targetPatch, reason) => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(perspectiveCameraScene, cameraOnlyShape),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 403.2,
        height: 403.2,
        paintKind: 'solid',
        baseFill: '#2F75B5',
        hasVisibleStroke: false,
        hasVisibleText: false,
        rotation: 0,
        flipH: false,
        flipV: false,
        ...targetPatch,
      },
      createMockRenderContext(),
    );

    expect(plan).toEqual({ mode: 'flat', reason });
  });

  it.each([
    [
      '<a:scene3d><a:camera prst="perspectiveRelaxedModerately" fov="6000000"><a:rot lat="18590633" lon="0" rev="0"/></a:camera><a:lightRig rig="threePt" dir="t"/></a:scene3d>',
      'camera-field-of-view',
    ],
    [
      '<a:scene3d><a:camera prst="perspectiveRelaxedModerately" fov="7200000" zoom="95000"><a:rot lat="18590633" lon="0" rev="0"/></a:camera><a:lightRig rig="threePt" dir="t"/></a:scene3d>',
      'camera-zoom',
    ],
    [
      '<a:scene3d><a:camera prst="perspectiveRelaxedModerately" fov="7200000"><a:rot lat="18000000" lon="0" rev="0"/></a:camera><a:lightRig rig="threePt" dir="t"/></a:scene3d>',
      'camera-rotation',
    ],
  ])('does not broaden camera support beyond the native matrix', (scene, reason) => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(scene, cameraOnlyShape),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 200,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      createMockRenderContext(),
    );
    expect(plan).toEqual({ mode: 'flat', reason });
  });

  it.each([
    [
      '<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/><a:backdrop/></a:scene3d>',
      cameraOnlyShape,
      'backdrop',
    ],
    [supportedScene, '<a:sp3d z="12700" extrusionH="0"/>', 'z-position'],
    [
      supportedScene,
      '<a:sp3d extrusionH="0"><a:extrusionClr><a:srgbClr val="FFFFFF"/></a:extrusionClr></a:sp3d>',
      'extrusion-paint',
    ],
  ])(
    'retains a diagnostic fallback for unverified scene/shape depth semantics',
    (scene, shape, reason) => {
      const plan = buildStaticShape3DPlan(
        parseShape3D(scene, shape),
        {
          nodeType: 'shape',
          presetGeometry: 'rect',
          width: 200,
          height: 100,
          paintKind: 'solid',
          baseFill: '#2F75B5',
        },
        createMockRenderContext(),
      );
      expect(plan).toEqual({ mode: 'flat', reason });
    },
  );

  it('builds the bounded orthographic circle top-bevel and contour plan', () => {
    const shape3d = parseShape3D(supportedScene, supportedShape);
    const plan = buildStaticShape3DPlan(
      shape3d,
      {
        nodeType: 'shape',
        presetGeometry: 'roundRect',
        width: 200,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({
      mode: 'orthographic-top-bevel',
      surface: 'shape',
      geometry: 'roundrect',
      faceColor: '#327ec4',
      bevel: { preset: 'circle' },
      contour: { color: '#FFFFFF' },
      light: { rig: 'threePt', direction: 't', azimuth: 350 },
    });
    if (plan.mode !== 'orthographic-top-bevel') throw new Error('expected supported plan');
    expect(plan.bevel.width).toBeCloseTo(13.3333, 3);
    expect(plan.bevel.height).toBeCloseTo(13.3333, 3);
    expect(plan.contour?.width).toBeCloseTo(1.3333, 3);
  });

  it('builds the top-bevel plan from the DrawingML default bevel dimensions', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, '<a:sp3d extrusionH="0"><a:bevelT/></a:sp3d>'),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 200,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({
      mode: 'orthographic-top-bevel',
      bevel: { preset: 'circle', width: 8, height: 8 },
    });
  });

  it('accepts the exact real-corpus picture light rotation and implicit circle bevel', () => {
    const shape3d = parseShape3D(
      `<a:scene3d>
         <a:camera prst="orthographicFront"/>
         <a:lightRig rig="twoPt" dir="t"><a:rot lat="0" lon="0" rev="7200000"/></a:lightRig>
       </a:scene3d>`,
      `<a:sp3d><a:bevelT w="25400" h="19050"/><a:contourClr><a:srgbClr val="FFFFFF"/></a:contourClr></a:sp3d>`,
      `<a:effectLst><a:outerShdw blurRad="55000" dist="18000"><a:srgbClr val="000000"/></a:outerShdw></a:effectLst>`,
    );
    const plan = buildStaticShape3DPlan(
      shape3d,
      { nodeType: 'picture', presetGeometry: 'rect', width: 320, height: 180 },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({
      mode: 'orthographic-top-bevel',
      surface: 'picture',
      bevel: { preset: 'circle' },
      contour: undefined,
      light: {
        rig: 'twoPt',
        direction: 't',
        rotation: { latitude: 0, longitude: 0, revolution: 120 },
      },
    });
  });

  it('calibrates implicit two-point picture lighting to the native edge ordering', () => {
    const shape3d = parseShape3D(
      `<a:scene3d>
         <a:camera prst="orthographicFront"/>
         <a:lightRig rig="twoPt" dir="t"/>
       </a:scene3d>`,
      `<a:sp3d extrusionH="0"><a:bevelT w="127000" h="127000" prst="circle"/></a:sp3d>`,
    );
    const plan = buildStaticShape3DPlan(
      shape3d,
      { nodeType: 'picture', presetGeometry: 'rect', width: 704, height: 384 },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({
      mode: 'orthographic-top-bevel',
      surface: 'picture',
      light: {
        rig: 'twoPt',
        direction: 't',
        azimuth: 225,
        elevation: 60,
        intensity: 0.8,
      },
    });
  });

  it('accepts only bounded nonnegative source crops with a visible picture area', () => {
    const shape3d = parseShape3D(
      `<a:scene3d>
         <a:camera prst="orthographicFront"/>
         <a:lightRig rig="twoPt" dir="t"/>
       </a:scene3d>`,
      `<a:sp3d extrusionH="0"><a:bevelT w="127000" h="127000" prst="circle"/></a:sp3d>`,
    );
    const target = {
      nodeType: 'picture' as const,
      presetGeometry: 'rect',
      width: 200,
      height: 100,
    };
    const ctx = createMockRenderContext();

    expect(
      buildStaticShape3DPlan(
        shape3d,
        {
          ...target,
          sourceCrop: { left: 0.22, top: 0.18, right: 0.08, bottom: 0.12 },
        },
        ctx,
      ),
    ).toMatchObject({ mode: 'orthographic-top-bevel', surface: 'picture' });
    for (const sourceCrop of [
      { left: -0.1, top: 0, right: 0, bottom: 0 },
      { left: 0.6, top: 0, right: 0.5, bottom: 0 },
      { left: 0, top: 0.999, right: 0, bottom: 0 },
    ]) {
      expect(buildStaticShape3DPlan(shape3d, { ...target, sourceCrop }, ctx)).toEqual({
        mode: 'flat',
        reason: 'picture-source-crop',
      });
    }
  });

  it.each([
    [
      'conflicting effect',
      parseShape3D(supportedScene, supportedShape, '<a:effectLst><a:glow rad="1"/></a:effectLst>'),
      'effect-list-conflict',
    ],
    ['line-like geometry', parseShape3D(supportedScene, supportedShape), 'line-like'],
  ])('keeps a flat fallback for %s', (label, shape3d, reason) => {
    const plan = buildStaticShape3DPlan(
      shape3d,
      {
        nodeType: 'shape',
        presetGeometry: label === 'line-like geometry' ? 'line' : 'roundRect',
        width: 200,
        height: 100,
        isLineLike: label === 'line-like geometry',
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({ mode: 'flat', reason });
  });

  it.each([
    [
      'camera-preset',
      `<a:scene3d><a:camera prst="perspectiveRelaxed"/><a:lightRig rig="threePt" dir="t"/></a:scene3d>`,
      supportedShape,
    ],
    [
      'camera-rotation',
      `<a:scene3d><a:camera prst="orthographicFront"><a:rot lat="0" lon="0" rev="60000"/></a:camera><a:lightRig rig="threePt" dir="t"/></a:scene3d>`,
      supportedShape,
    ],
    [
      'extrusion-height',
      supportedScene,
      supportedShape.replace('<a:sp3d ', '<a:sp3d extrusionH="12700" '),
    ],
    [
      'bottom-bevel',
      supportedScene,
      supportedShape.replace('</a:sp3d>', '<a:bevelB w="12700" h="12700"/></a:sp3d>'),
    ],
    [
      'preset-material',
      supportedScene,
      supportedShape.replace('<a:sp3d ', '<a:sp3d prstMaterial="metal" '),
    ],
  ])('classifies %s in the render planner', (reason, sceneXml, shapeXml) => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(sceneXml, shapeXml),
      {
        nodeType: 'shape',
        presetGeometry: 'roundRect',
        width: 200,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({ mode: 'flat', reason });
  });

  it.each([
    [200, 200, 330],
    [320, 120, 350],
    [120, 320, 350],
  ])('builds the bounded ellipse plan at %sx%s', (width, height, azimuth) => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'shape',
        presetGeometry: 'ellipse',
        width,
        height,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({
      mode: 'orthographic-top-bevel',
      surface: 'shape',
      geometry: 'ellipse',
      bounds: { width, height },
      light: { azimuth, shadowFloor: undefined, shadowScale: undefined },
    });
  });

  it('accepts an adjusted donut whose resolved path carries the OOXML hole geometry', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'shape',
        presetGeometry: 'donut',
        width: 240,
        height: 160,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({
      mode: 'orthographic-top-bevel',
      surface: 'shape',
      geometry: 'donut',
      bounds: { width: 240, height: 160 },
    });
  });

  it.each([
    [110, 200, 285, undefined, 0, 0.9],
    [200, 200, 285, undefined, 0.6, 0.25],
    [500, 200, 300, 1.02, 0.7, 0.4],
  ])(
    'uses the native-backed broad donut shadow profile at %sx%s',
    (width, height, shadowAzimuth, highlightScale, shadowFloor, shadowScale) => {
      const plan = buildStaticShape3DPlan(
        parseShape3D(supportedScene, supportedShape),
        {
          nodeType: 'shape',
          presetGeometry: 'donut',
          width,
          height,
          paintKind: 'solid',
          baseFill: '#2F75B5',
        },
        createMockRenderContext(),
      );

      expect(plan).toMatchObject({
        mode: 'orthographic-top-bevel',
        light: { shadowAzimuth, highlightScale, shadowFloor, shadowScale },
      });
    },
  );

  it('keeps the native-backed split shadow bearing for a grouped stretched donut', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'shape',
        presetGeometry: 'donut',
        width: 114,
        height: 200,
        sourceBounds: { width: 200, height: 200 },
        paintKind: 'solid',
        baseFill: '#70AD47',
        container: 'group',
      },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({
      mode: 'orthographic-top-bevel',
      lightingBounds: { width: 200, height: 200 },
      light: {
        azimuth: 330,
        shadowAzimuth: 258,
        shadowFloor: 0.5,
        shadowMaterialScale: 1.05,
        shadowScale: 0.35,
      },
    });
    if (plan.mode !== 'orthographic-top-bevel') throw new Error('expected a top-bevel plan');
    expect(plan.light.shadowDirectionMix).toBeUndefined();
  });

  it('does not select child-coordinate calibration when grouped donut source bounds are invalid', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'shape',
        presetGeometry: 'donut',
        width: 114,
        height: 200,
        sourceBounds: { width: 0, height: 200 },
        paintKind: 'solid',
        baseFill: '#70AD47',
        container: 'group',
      },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({
      mode: 'orthographic-top-bevel',
      lightingBounds: { width: 114, height: 200 },
      light: { shadowAzimuth: 285 },
    });
    if (plan.mode !== 'orthographic-top-bevel') throw new Error('expected a top-bevel plan');
    expect(plan.light.shadowFloor).not.toBe(0.5);
    expect(plan.light.shadowMaterialScale).toBeUndefined();
  });

  it('keeps rounded pictures outside the bounded geometry cohort', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'picture',
        presetGeometry: 'roundRect',
        width: 200,
        height: 100,
        paintKind: 'picture',
      },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({ mode: 'flat', reason: 'geometry-preset' });
  });

  it('rejects invalid render bounds instead of producing non-finite filter values', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: Number.NaN,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({ mode: 'flat', reason: 'invalid-bounds' });
  });

  it('requires a resolved opaque solid color for the shape face material', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 200,
        height: 100,
        paintKind: 'solid',
      },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({ mode: 'flat', reason: 'paint-kind' });
  });

  it('rejects a positive contour width without a resolvable contour color', () => {
    const plan = buildStaticShape3DPlan(
      parseShape3D(
        supportedScene,
        `<a:sp3d contourW="12700">
           <a:bevelT w="127000" h="127000" prst="circle"/>
         </a:sp3d>`,
      ),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 200,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      createMockRenderContext(),
    );

    expect(plan).toMatchObject({ mode: 'flat', reason: 'contour-paint' });
  });
});

describe('appendStaticShape3DEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rasterizes grouped bevel lighting in child coordinates before stretching the texture', async () => {
    const mocks = installShape3DRasterMocks();
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const defs = document.createElementNS(ns, 'defs');
    svg.appendChild(defs);
    const ctx = createMockRenderContext({ asyncTasks: [] });
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'shape',
        presetGeometry: 'donut',
        width: 114,
        height: 200,
        sourceBounds: { width: 200, height: 200 },
        paintKind: 'solid',
        baseFill: '#70AD47',
        container: 'group',
      },
      ctx,
    );

    const result = appendStaticShape3DEffects({
      svg,
      defs,
      pathD: 'M0,0 H114 V200 H0 Z',
      bounds: { width: 114, height: 200 },
      plan,
      ctx,
    });

    mocks.complete(new Blob([new Uint8Array([1])], { type: 'image/png' }));
    await Promise.all(ctx.asyncTasks!);

    expect(mocks.maskContext.getImageData).toHaveBeenCalledWith(0, 0, 400, 400);
    expect(mocks.maskContext.setTransform).toHaveBeenCalledWith(400 / 114, 0, 0, 2, 0, 0);
    const lighting = result?.group.querySelector('[data-pptx-shape3d-lighting]');
    expect(lighting?.getAttribute('width')).toBe('114');
    expect(lighting?.getAttribute('height')).toBe('200');
  });

  it('replaces the flat path with a projected plane and native-backed material gradient', () => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const defs = document.createElementNS(ns, 'defs');
    const basePath = document.createElementNS(ns, 'path');
    basePath.setAttribute('d', 'M0,0 H403.2 V403.2 H0 Z');
    basePath.setAttribute('fill', '#2F75B5');
    svg.append(basePath);
    const ctx = createMockRenderContext({
      presentation: { ...createMockRenderContext().presentation, width: 1280, height: 720 },
    });
    const plan = buildStaticShape3DPlan(
      parseShape3D(perspectiveCameraScene, cameraOnlyShape),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 403.2,
        height: 403.2,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      ctx,
    );

    const result = appendStaticShape3DEffects({
      svg,
      defs,
      basePath,
      pathD: basePath.getAttribute('d')!,
      bounds: { width: 403.2, height: 403.2 },
      plan,
      ctx,
    });

    expect(result?.group.dataset.pptxShape3dCamera).toBe('perspectiveRelaxedModerately');
    expect(basePath.getAttribute('visibility')).toBe('hidden');
    const projected = svg.querySelector('[data-pptx-shape3d-projected-plane]');
    expect(projected?.getAttribute('d')).toContain('M62.');
    expect(projected?.getAttribute('fill')).toMatch(/^url\(#shape3d-camera-gradient-/);
    expect(svg.querySelectorAll('linearGradient[data-pptx-shape3d-camera-gradient]')).toHaveLength(
      1,
    );
  });

  it('projects a multi-contour cubic path without replacing its silhouette with a rectangle', () => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const defs = document.createElementNS(ns, 'defs');
    const basePath = document.createElementNS(ns, 'path');
    const pathD =
      'M0,201.6 C0,48.4 112.9,0 181.4,64.5 C225.8,108.9 193.5,201.6 121,233.9 L0,290.3 Z ' +
      'M225.8,72.6 C282.2,8.1 403.2,48.4 383,173.4 C370.9,274.2 274.2,362.9 209.7,290.3 C165.3,237.9 181.4,129 225.8,72.6 Z';
    basePath.setAttribute('d', pathD);
    basePath.setAttribute('fill', '#2F75B5');
    svg.append(basePath);
    const ctx = createMockRenderContext({
      presentation: { ...createMockRenderContext().presentation, width: 1280, height: 720 },
    });
    const plan = buildStaticShape3DPlan(
      parseShape3D(perspectiveCameraScene, ''),
      {
        nodeType: 'shape',
        width: 403.2,
        height: 403.2,
        paintKind: 'solid',
        baseFill: '#2F75B5',
        hasCustomGeometry: true,
        customGeometryProfile: 'multi-contour-cubic',
        container: 'standalone-slide',
      },
      ctx,
    );

    const result = appendStaticShape3DEffects({
      svg,
      defs,
      basePath,
      pathD,
      bounds: { width: 403.2, height: 403.2 },
      plan,
      ctx,
    });

    expect(basePath.getAttribute('visibility')).toBe('hidden');
    expect(result?.group.dataset.pptxShape3dCameraGeometry).toBe('custom');
    const projected = result?.group.querySelector<SVGPathElement>(
      '[data-pptx-shape3d-projected-custom-plane]',
    );
    expect(projected?.getAttribute('d')).not.toBe(pathD);
    expect(projected?.getAttribute('d')?.match(/M/g)).toHaveLength(2);
    expect(projected?.getAttribute('d')?.match(/Z/g)).toHaveLength(2);
    expect(projected?.getAttribute('d')).not.toContain('C');
    expect(projected?.getAttribute('d')?.match(/L/g)?.length).toBeGreaterThan(16);
    expect(projected?.style.transform).toBe('');
    expect(projected?.getAttribute('fill')).toMatch(/^url\(#shape3d-camera-gradient-/);
  });

  it('keeps vector faces until the contour-aware texture is ready, then swaps only the lighting', async () => {
    const mocks = installShape3DRasterMocks();
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const defs = document.createElementNS(ns, 'defs');
    svg.appendChild(defs);
    const ctx = createMockRenderContext({ asyncTasks: [] });
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'shape',
        presetGeometry: 'roundRect',
        width: 200,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      ctx,
    );

    const result = appendStaticShape3DEffects({
      svg,
      defs,
      pathD: 'M0,20 Q0,0 20,0 H180 Q200,0 200,20 V80 Q200,100 180,100 H20 Q0,100 0,80 Z',
      bounds: { width: 200, height: 100 },
      plan,
      ctx,
    });

    expect(result?.group.querySelectorAll('[data-pptx-shape3d-face]')).toHaveLength(4);
    expect(result?.group.querySelector('[data-pptx-shape3d-lighting]')).toBeNull();
    expect(ctx.asyncTasks).toHaveLength(1);
    mocks.complete(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    await Promise.all(ctx.asyncTasks!);

    expect(result?.group.querySelectorAll('[data-pptx-shape3d-face]')).toHaveLength(0);
    const lighting = result?.group.querySelector('[data-pptx-shape3d-lighting]');
    expect(lighting?.getAttribute('data-pptx-shape3d-lighting')).toBe('distance-field');
    expect(lighting?.getAttribute('width')).toBe('200');
    expect(lighting?.getAttribute('height')).toBe('100');
    expect(ctx.mediaUrlCache.size).toBe(1);
    expect(mocks.maskContext.fill).toHaveBeenCalledWith(expect.anything(), 'evenodd');
    expect(mocks.outputContext.putImageData).toHaveBeenCalledOnce();
  });

  it('keeps the vector fallback and blocks late DOM writes when the slide is aborted', async () => {
    const mocks = installShape3DRasterMocks();
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const defs = document.createElementNS(ns, 'defs');
    svg.appendChild(defs);
    const abortController = new AbortController();
    const ctx = createMockRenderContext({ asyncTasks: [], signal: abortController.signal });
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 200,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      ctx,
    );
    const result = appendStaticShape3DEffects({
      svg,
      defs,
      pathD: 'M0,0 H200 V100 H0 Z',
      bounds: { width: 200, height: 100 },
      plan,
      ctx,
    });

    abortController.abort();
    mocks.complete(new Blob([new Uint8Array([1])], { type: 'image/png' }));
    await Promise.all(ctx.asyncTasks!);

    expect(result?.group.querySelectorAll('[data-pptx-shape3d-face]')).toHaveLength(4);
    expect(result?.group.querySelector('[data-pptx-shape3d-lighting]')).toBeNull();
    expect(ctx.mediaUrlCache.size).toBe(0);
  });

  it('reuses a completed texture through the render-context media cache', async () => {
    const mocks = installShape3DRasterMocks();
    const ns = 'http://www.w3.org/2000/svg';
    const makeSvg = () => {
      const svg = document.createElementNS(ns, 'svg');
      const defs = document.createElementNS(ns, 'defs');
      svg.appendChild(defs);
      return { svg, defs };
    };
    const ctx = createMockRenderContext({ asyncTasks: [] });
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 200,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      ctx,
    );
    const first = makeSvg();
    appendStaticShape3DEffects({
      ...first,
      pathD: 'M0,0 H200 V100 H0 Z',
      bounds: { width: 200, height: 100 },
      plan,
      ctx,
    });
    mocks.complete(new Blob([new Uint8Array([1])], { type: 'image/png' }));
    await Promise.all(ctx.asyncTasks!);

    const firstHref = first.svg.querySelector('[data-pptx-shape3d-lighting]')?.getAttribute('href');
    const second = makeSvg();
    appendStaticShape3DEffects({
      ...second,
      pathD: 'M0,0 H200 V100 H0 Z',
      bounds: { width: 200, height: 100 },
      plan,
      ctx,
    });
    await Promise.all(ctx.asyncTasks!);

    expect(second.svg.querySelector('[data-pptx-shape3d-lighting]')?.getAttribute('href')).toBe(
      firstHref,
    );
    expect(mocks.toBlob).toHaveBeenCalledOnce();
  });

  it('resolves a missing Canvas backend without removing the vector fallback', async () => {
    vi.stubGlobal('Path2D', class MockPath2D {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const defs = document.createElementNS(ns, 'defs');
    svg.appendChild(defs);
    const ctx = createMockRenderContext({ asyncTasks: [] });
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 200,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      ctx,
    );
    const result = appendStaticShape3DEffects({
      svg,
      defs,
      pathD: 'M0,0 H200 V100 H0 Z',
      bounds: { width: 200, height: 100 },
      plan,
      ctx,
    });
    await Promise.all(ctx.asyncTasks!);

    expect(result?.group.querySelectorAll('[data-pptx-shape3d-face]')).toHaveLength(4);
    expect(result?.group.querySelector('[data-pptx-shape3d-lighting]')).toBeNull();
  });

  it('partitions the inward bevel into independently lit faces and a separate contour', () => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const defs = document.createElementNS(ns, 'defs');
    const base = document.createElementNS(ns, 'path');
    const pathD = 'M0,0 L200,0 L200,100 L0,100 Z';
    base.setAttribute('d', pathD);
    svg.append(defs, base);
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 200,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      createMockRenderContext(),
    );

    const result = appendStaticShape3DEffects({
      svg,
      defs,
      pathD,
      bounds: { width: 200, height: 100 },
      plan,
    });

    expect(result).toBeTruthy();
    const bevel = svg.querySelector('[data-pptx-shape3d-bevel]');
    expect(bevel?.getAttribute('clip-path')).toMatch(/^url\(#shape3d-clip-/);
    expect(
      Array.from(bevel?.querySelectorAll('path[data-pptx-shape3d-face]') ?? [], (path) =>
        path.getAttribute('data-pptx-shape3d-face'),
      ),
    ).toEqual(['top', 'right', 'bottom', 'left']);
    expect(bevel?.querySelectorAll('path[data-pptx-shape3d-face][filter]')).toHaveLength(0);
    expect(
      Array.from(bevel?.querySelectorAll('path[data-pptx-shape3d-face]') ?? []).every(
        (path) => path.getAttribute('d') === pathD,
      ),
    ).toBe(true);
    expect(svg.querySelectorAll('linearGradient[data-pptx-shape3d-face-gradient]')).toHaveLength(4);

    const contour = svg.querySelector('path[data-pptx-shape3d-contour]');
    expect(contour?.getAttribute('fill')).toBe('none');
    expect(contour?.getAttribute('stroke')).toBe('#FFFFFF');
    expect(contour?.hasAttribute('filter')).toBe(false);
  });

  it('uses bevel width for the inward extent and height only for lighting contrast', () => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const defs = document.createElementNS(ns, 'defs');
    svg.appendChild(defs);
    const plan = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape.replace('h="127000"', 'h="254000"')),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 200,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      createMockRenderContext(),
    );

    appendStaticShape3DEffects({
      svg,
      defs,
      pathD: 'M0,0 H200 V100 H0 Z',
      bounds: { width: 200, height: 100 },
      plan,
    });

    for (const face of svg.querySelectorAll('path[data-pptx-shape3d-face]')) {
      expect(Number(face.getAttribute('stroke-width'))).toBeCloseTo(26.6667, 3);
    }
  });

  it('allocates unique local IDs and is a no-op for a flat plan', () => {
    const ns = 'http://www.w3.org/2000/svg';
    const makeSvg = () => {
      const svg = document.createElementNS(ns, 'svg');
      const defs = document.createElementNS(ns, 'defs');
      svg.appendChild(defs);
      return { svg, defs };
    };
    const supported = buildStaticShape3DPlan(
      parseShape3D(supportedScene, supportedShape),
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 200,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      createMockRenderContext(),
    );
    const first = makeSvg();
    const second = makeSvg();

    appendStaticShape3DEffects({
      ...first,
      pathD: 'M0,0 H200 V100 H0 Z',
      bounds: { width: 200, height: 100 },
      plan: supported,
    });
    appendStaticShape3DEffects({
      ...second,
      pathD: 'M0,0 H200 V100 H0 Z',
      bounds: { width: 200, height: 100 },
      plan: supported,
    });

    const ids = [first.svg, second.svg].flatMap((root) =>
      Array.from(root.querySelectorAll('[id]'), (el) => el.id),
    );
    expect(new Set(ids).size).toBe(ids.length);

    const flat = buildStaticShape3DPlan(
      undefined,
      {
        nodeType: 'shape',
        presetGeometry: 'rect',
        width: 200,
        height: 100,
        paintKind: 'solid',
        baseFill: '#2F75B5',
      },
      createMockRenderContext(),
    );
    const target = makeSvg();
    expect(
      appendStaticShape3DEffects({
        ...target,
        pathD: 'M0,0 H200 V100 H0 Z',
        bounds: { width: 200, height: 100 },
        plan: flat,
      }),
    ).toBeUndefined();
    expect(target.svg.querySelector('[data-pptx-shape3d-bevel]')).toBeNull();
  });
});
