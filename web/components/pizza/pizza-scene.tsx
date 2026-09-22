'use client';

import { useEffect, useRef, useState } from 'react';
import type { PizzaOrder, ToppingId } from '@/lib/pizza';
import type * as THREE from 'three';

type PizzaSelection = Pick<PizzaOrder, 'pizzaType' | 'toppings'>;
type SceneControls = { update: (selection: PizzaSelection) => void; reset: () => void };

export function PizzaScene({ pizzaType, toppings }: PizzaSelection) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SceneControls | null>(null);
  const selection = useRef({ pizzaType, toppings });
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    selection.current = { pizzaType, toppings };
    scene.current?.update(selection.current);
  }, [pizzaType, toppings]);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]).then(([T, { OrbitControls }]) => {
      if (cancelled || !host.current) return;
      const container = host.current;
      const world = new T.Scene();
      const camera = new T.PerspectiveCamera(35, 1, 0.1, 50);
      camera.position.set(0, 6.8, 7.8);
      let renderer: THREE.WebGLRenderer;
      try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); }
      catch { setState('unavailable'); return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFShadowMap;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.setClearColor(0xf5f5f5, 0);
      renderer.domElement.setAttribute('aria-label', '3D preview of your pizza. Drag to rotate.');
      container.appendChild(renderer.domElement);

      const orbit = new OrbitControls(camera, renderer.domElement);
      orbit.enablePan = false;
      orbit.enableZoom = false;
      orbit.minPolarAngle = 0.2;
      orbit.maxPolarAngle = Math.PI / 2.6;
      orbit.target.set(0, 0.15, 0);
      orbit.update();
      orbit.saveState();

      world.add(new T.HemisphereLight(0xffffff, 0xa8a3a0, 2.6));
      const light = new T.DirectionalLight(0xfff5e8, 3.2);
      light.position.set(-3, 7, 4);
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.camera.left = light.shadow.camera.bottom = -3.5;
      light.shadow.camera.right = light.shadow.camera.top = 3.5;
      light.shadow.normalBias = 0.035;
      world.add(light);
      const fill = new T.DirectionalLight(0xffffff, 1.2);
      fill.position.set(4, 2, -3);
      world.add(fill);

      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const mat = (color: number, roughness = 0.8) => {
        const material = new T.MeshStandardMaterial({ color, roughness });
        materials.add(material);
        return material;
      };
      const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
        geometries.add(geometry);
        materials.add(material);
        const result = new T.Mesh(geometry, material);
        result.position.set(x, y, z);
        result.castShadow = true;
        result.receiveShadow = true;
        parent.add(result);
        return result;
      };
      const pizza = new T.Group();
      world.add(pizza);
      mesh(new T.CylinderGeometry(2.43, 2.33, 0.1, 96), mat(0xffffff, 0.3), world, 0, -0.11);
      const plateLip = mesh(new T.TorusGeometry(2.33, 0.045, 8, 96), mat(0xe5e5e5, 0.3), world, 0, -0.035);
      plateLip.rotation.x = Math.PI / 2;

      // Baked color is deterministic, so the crust never changes with an order edit.
      const bread = mat(0xffffff);
      bread.vertexColors = true;
      const dough = new T.CylinderGeometry(2.03, 1.97, 0.21, 96, 3);
      const crust = new T.TorusGeometry(1.94, 0.165, 16, 128);
      function baked(geometry: THREE.BufferGeometry) {
        const position = geometry.getAttribute('position');
        const colors: number[] = [];
        const color = new T.Color();
        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
          const noise = (Math.sin(x * 26 + y * 17 + z * 39) + Math.sin(x * 43 - y * 32)) / 2;
          color.setHex(noise > 0.62 ? 0x8c461f : noise > 0.22 ? 0xc77b36 : 0xe8b66e);
          colors.push(color.r, color.g, color.b);
        }
        geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      }
      baked(dough); baked(crust);
      mesh(dough, bread, pizza, 0, 0.06);
      const rim = mesh(crust, bread, pizza, 0, 0.19);
      rim.rotation.x = Math.PI / 2;
      rim.scale.z = 0.82;
      mesh(new T.CylinderGeometry(1.85, 1.86, 0.04, 96), mat(0xb83b21, 0.65), pizza, 0, 0.18);

      const groups = new Map<ToppingId, THREE.Group>();
      function topping(id: ToppingId) {
        const group = new T.Group();
        group.name = id;
        pizza.add(group);
        groups.set(id, group);
        return group;
      }
      function points(count: number, offset: number) {
        return Array.from({ length: count }, (_, i) => {
          const angle = i * 2.39996 + offset;
          const radius = Math.sqrt((i + 0.5) / count) * 1.56;
          return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, angle };
        });
      }
      const cheese = topping('mozzarella');
      mesh(new T.CylinderGeometry(1.79, 1.82, 0.035, 96), mat(0xf3ce7b, 0.6), cheese, 0, 0.21);
      const cheeseBlob = new T.SphereGeometry(1, 10, 6);
      const melted = mat(0xffe6a4, 0.55);
      const toasted = mat(0xc28237);
      points(64, 0.4).forEach((p, i) => {
        const blob = mesh(cheeseBlob, i % 5 === 0 ? toasted : melted, cheese, p.x, 0.235, p.z);
        blob.scale.set(0.08 + (i % 4) * 0.028, 0.012, 0.08 + (i % 3) * 0.03);
      });

      const pepperoni = topping('pepperoni');
      const salami = new T.CylinderGeometry(0.225, 0.21, 0.037, 24);
      const red = mat(0xb32e1e, 0.58), fat = mat(0xf2ad76);
      const fleck = new T.SphereGeometry(0.021, 6, 4);
      points(14, 0).forEach(p => {
        mesh(salami, red, pepperoni, p.x, 0.267, p.z);
        for (let i = 0; i < 6; i++) {
          const a = p.angle + i * 2.4, r = i % 2 ? 0.14 : 0.07;
          const spot = mesh(fleck, fat, pepperoni, p.x + Math.cos(a) * r, 0.288, p.z + Math.sin(a) * r);
          spot.scale.y = 0.25;
        }
      });

      const mushrooms = topping('mushrooms');
      const mushroomShape = new T.Shape();
      mushroomShape.moveTo(-0.21, 0);
      mushroomShape.bezierCurveTo(-0.21, 0.27, 0.21, 0.27, 0.21, 0);
      mushroomShape.lineTo(0.055, 0); mushroomShape.lineTo(0.065, -0.15);
      mushroomShape.lineTo(-0.065, -0.15); mushroomShape.lineTo(-0.055, 0); mushroomShape.closePath();
      const mushroomGeo = new T.ExtrudeGeometry(mushroomShape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1, steps: 1, curveSegments: 12 });
      const mushroomMat = mat(0xd6bc95);
      points(13, 1.4).forEach(p => {
        const piece = mesh(mushroomGeo, mushroomMat, mushrooms, p.x, 0.31, p.z);
        piece.rotation.set(-Math.PI / 2, 0, p.angle);
      });

      const onion = topping('red_onion');
      const onionGeo = new T.TorusGeometry(0.18, 0.025, 6, 22, Math.PI * 1.4);
      const onionMat = mat(0x982e65);
      points(15, 2).forEach(p => { const piece = mesh(onionGeo, onionMat, onion, p.x, 0.325, p.z); piece.rotation.set(Math.PI / 2, 0, p.angle); });

      const peppers = topping('bell_pepper');
      const pepperGeo = new T.TorusGeometry(0.16, 0.042, 6, 16, Math.PI * 1.1);
      const pepperMat = mat(0x48833c, 0.55);
      points(14, 0.8).forEach(p => { const piece = mesh(pepperGeo, pepperMat, peppers, p.x, 0.35, p.z); piece.rotation.set(Math.PI / 2, 0, p.angle); });

      for (const [id, color, radius, height, count, offset] of [
        ['olives', 0x29281d, 0.094, 0.375, 21, 2.7],
        ['jalapenos', 0x4f822f, 0.14, 0.39, 11, 3.6],
      ] as const) {
        const group = topping(id);
        const geometry = new T.TorusGeometry(radius, id === 'olives' ? 0.035 : 0.047, 8, 20);
        const material = mat(color, 0.5);
        points(count, offset).forEach(p => { const piece = mesh(geometry, material, group, p.x, height, p.z); piece.rotation.x = Math.PI / 2; });
      }
      const pineapple = topping('pineapple');
      const pineappleGeo = new T.BoxGeometry(0.16, 0.085, 0.22);
      const yellow = mat(0xf6bc3a, 0.58);
      points(15, 4).forEach(p => { mesh(pineappleGeo, yellow, pineapple, p.x, 0.39, p.z).rotation.y = p.angle; });

      const basil = topping('basil');
      const leafShape = new T.Shape();
      leafShape.moveTo(0, -0.21);
      leafShape.bezierCurveTo(-0.19, -0.03, -0.18, 0.16, 0, 0.26);
      leafShape.bezierCurveTo(0.18, 0.1, 0.16, -0.08, 0, -0.21);
      const leafGeo = new T.ExtrudeGeometry(leafShape, { depth: 0.012, bevelEnabled: false, curveSegments: 12 });
      const green = mat(0x34762e, 0.6);
      points(7, 5.3).forEach(p => { const leaf = mesh(leafGeo, green, basil, p.x, 0.42, p.z); leaf.rotation.set(-Math.PI / 2, 0.15, p.angle); });

      const corn = topping('sweetcorn');
      const kernelGeo = new T.SphereGeometry(0.055, 8, 6);
      const cornMat = mat(0xffcf42, 0.45);
      points(45, 5.9).forEach(p => { const piece = mesh(kernelGeo, cornMat, corn, p.x, 0.39, p.z); piece.scale.set(0.8, 0.7, 1.2); piece.rotation.y = p.angle; });

      const ground = mesh(new T.PlaneGeometry(200, 200), new T.ShadowMaterial({ opacity: 0.1 }), world, 0, -0.18);
      ground.rotation.x = -Math.PI / 2;
      ground.castShadow = false;
      const render = () => { if (!cancelled) renderer.render(world, camera); };
      const update = ({ pizzaType, toppings }: PizzaSelection) => {
        pizza.visible = pizzaType !== null;
        groups.forEach((group, id) => { group.visible = toppings.includes(id); });
        render();
      };
      const resize = () => {
        const { width, height } = container.getBoundingClientRect();
        if (!width || !height) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        render();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      orbit.addEventListener('change', render);
      const lost = (event: Event) => { event.preventDefault(); setState('unavailable'); };
      const restored = () => { setState('ready'); render(); };
      renderer.domElement.addEventListener('webglcontextlost', lost);
      renderer.domElement.addEventListener('webglcontextrestored', restored);
      scene.current = { update, reset: () => { orbit.reset(); render(); } };
      update(selection.current);
      resize();
      setState('ready');
      dispose = () => {
        observer.disconnect(); orbit.dispose();
        renderer.domElement.removeEventListener('webglcontextlost', lost);
        renderer.domElement.removeEventListener('webglcontextrestored', restored);
        geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
        renderer.dispose(); renderer.domElement.remove();
      };
    }).catch(() => { if (!cancelled) setState('unavailable'); });
    return () => { cancelled = true; scene.current = null; dispose?.(); };
  }, []);

  return <div className="pizza-preview">
    <div ref={host} className="pizza-canvas" />
    {state === 'loading' && <p className="pizza-preview-message" role="status">Setting the table…</p>}
    {state === 'unavailable' && <p className="pizza-preview-message" role="status">The 3D preview isn’t available in this browser. You can still order by voice and follow the order summary below.</p>}
    {state === 'ready' && <div className="pizza-preview-controls"><span>Drag to give it a spin</span><button type="button" onClick={() => scene.current?.reset()}>Reset view</button></div>}
  </div>;
}
