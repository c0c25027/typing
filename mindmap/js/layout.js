/**
 * layout.js
 * ノード同士の反発力とエッジのばね力で配置を決める、簡易的な力学モデルのレイアウトです。
 * ノード数は数百程度までを想定しており、反発力は O(n^2) で計算します。
 */
class ForceLayout {
  /**
   * @param {MindMapModel} model 配置対象のモデルです。
   * @param {(Function)} onTick 位置更新のたびに呼ばれる関数です。
   */
  constructor(model, onTick) {
    this.model = model;
    this.onTick = onTick;
    /** ばねの自然長（px）です。 */
    this.linkDistance = 110;
    /** ばねの強さです。 */
    this.linkStrength = 0.04;
    /** ノード間の反発力の強さです。 */
    this.repulsion = 9000;
    /** 原点へ引き寄せる力の強さです（全体が流れていかないようにします）。 */
    this.gravity = 0.012;
    /** 速度の減衰率です（1 に近いほど長く動きます）。 */
    this.damping = 0.82;
    /** 動きの大きさです。徐々に下げ、一定以下になったら停止します。 */
    this.alpha = 0;
    this.frame = null;
  }

  /**
   * レイアウト計算を（再）開始します。
   * @param {number} [alpha] 開始時の動きの大きさ（0〜1）です。
   */
  start(alpha = 1) {
    this.alpha = Math.max(this.alpha, alpha);
    if (this.frame == null) this.frame = requestAnimationFrame(() => this.loop());
  }

  /** アニメーションループです。alpha が十分小さくなったら停止します。 */
  loop() {
    this.frame = null;
    this.step();
    this.onTick();
    this.alpha *= 0.985;
    if (this.alpha > 0.01) this.frame = requestAnimationFrame(() => this.loop());
  }

  /** 1ステップ分の力を計算し、位置を更新します。 */
  step() {
    const nodes = [...this.model.nodes.values()];
    const a = this.alpha;

    // ノード間の反発力（クーロン力に近い形）です。
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        let dx = n2.x - n1.x;
        let dy = n2.y - n1.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          // 完全に重なった場合は少しずらして、0 除算を避けます。
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const f = (this.repulsion / Math.max(d2, 400)) * a;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        n1.vx -= fx;
        n1.vy -= fy;
        n2.vx += fx;
        n2.vy += fy;
      }
    }

    // エッジのばね力です。
    for (const e of this.model.edges) {
      const s = this.model.nodes.get(e.source);
      const t = this.model.nodes.get(e.target);
      if (!s || !t) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - this.linkDistance) * this.linkStrength * a;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }

    // 原点への引力と、速度の反映です。固定中のノードは動かしません。
    for (const n of nodes) {
      if (n.pinned) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx = (n.vx - n.x * this.gravity * a) * this.damping;
      n.vy = (n.vy - n.y * this.gravity * a) * this.damping;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
}
