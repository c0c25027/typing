/**
 * view.js
 * マインドマップを SVG に描画し、ノードの選択・ドラッグ、画面のパン・ズームを扱うビュー層です。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

class MindMapView {
  /**
   * @param {SVGSVGElement} svg 描画先の SVG 要素です。
   * @param {MindMapModel} model 描画対象のモデルです。
   * @param {object} callbacks
   * @param {(id: number|null) => void} callbacks.onSelect ノード選択（背景クリック時は null）を通知します。
   * @param {(id: number) => void} callbacks.onActivate ノードのダブルクリックを通知します。
   * @param {() => void} callbacks.onDragMove ドラッグでノードを動かしたことを通知します。
   */
  constructor(svg, model, callbacks) {
    this.svg = svg;
    this.model = model;
    this.callbacks = callbacks;
    this.selectedId = null;
    /** 画面の平行移動量と拡大率です。 */
    this.transform = { x: 0, y: 0, k: 1 };
    /** @type {Map<number, SVGGElement>} */
    this.nodeEls = new Map();
    /** @type {{el: SVGLineElement, edge: object}[]} */
    this.edgeEls = [];
    /** 進行中のポインタ操作（ドラッグ／パン）の状態です。 */
    this.drag = null;
    /**
     * 直前にクリックしたノードと時刻です。ダブルクリック判定に使います。
     * ポインタキャプチャ中は dblclick イベントの target が SVG 全体になるため、自前で判定します。
     */
    this.lastClick = { id: null, time: 0 };

    this.viewport = this.createEl('g', { class: 'viewport' });
    this.edgeLayer = this.createEl('g', { class: 'edges' });
    this.nodeLayer = this.createEl('g', { class: 'nodes' });
    this.viewport.append(this.edgeLayer, this.nodeLayer);
    this.svg.append(this.viewport);

    this.bindEvents();
    this.resetView();
  }

  /**
   * SVG 要素を属性付きで作成します。
   * @param {string} tag タグ名です。
   * @param {object} attrs 設定する属性です。
   * @returns {SVGElement} 作成した要素です。
   */
  createEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  /** 表示を初期状態（原点を画面中央、等倍）に戻します。 */
  resetView() {
    const rect = this.svg.getBoundingClientRect();
    this.transform = { x: rect.width / 2, y: rect.height / 2, k: 1 };
    this.applyTransform();
  }

  /** 現在の平行移動・拡大率を viewport グループに反映します。 */
  applyTransform() {
    const { x, y, k } = this.transform;
    this.viewport.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
  }

  /**
   * 画面座標をマップ上の座標に変換します。
   * @param {number} clientX クライアント X 座標です。
   * @param {number} clientY クライアント Y 座標です。
   * @returns {{x: number, y: number}} マップ座標です。
   */
  toWorld(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.transform.x) / this.transform.k,
      y: (clientY - rect.top - this.transform.y) / this.transform.k,
    };
  }

  /** ポインタ・ホイール操作のイベントを登録します。 */
  bindEvents() {
    this.svg.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    this.svg.addEventListener('pointermove', (e) => this.handlePointerMove(e));
    this.svg.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    this.svg.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
    this.svg.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
  }

  /**
   * ポインタ押下時の処理です。ノード上ならドラッグ、背景ならパンを開始します。
   * @param {PointerEvent} e イベントです。
   */
  handlePointerDown(e) {
    if (e.button !== 0) return;
    const nodeEl = e.target.closest('.node');
    this.svg.setPointerCapture(e.pointerId);
    if (nodeEl) {
      const node = this.model.nodes.get(Number(nodeEl.dataset.id));
      if (!node) return;
      const p = this.toWorld(e.clientX, e.clientY);
      node.pinned = true;
      this.drag = { type: 'node', node, offsetX: node.x - p.x, offsetY: node.y - p.y, startX: e.clientX, startY: e.clientY, moved: false };
    } else {
      this.drag = { type: 'pan', startX: e.clientX, startY: e.clientY, originX: this.transform.x, originY: this.transform.y, moved: false };
    }
  }

  /**
   * ポインタ移動時の処理です。4px 以上動いたらドラッグとして扱います。
   * @param {PointerEvent} e イベントです。
   */
  handlePointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.type === 'node') {
      const p = this.toWorld(e.clientX, e.clientY);
      d.node.x = p.x + d.offsetX;
      d.node.y = p.y + d.offsetY;
      this.updatePositions();
      this.callbacks.onDragMove();
    } else {
      this.transform.x = d.originX + dx;
      this.transform.y = d.originY + dy;
      this.applyTransform();
    }
  }

  /**
   * ポインタを離したときの処理です。動いていなければクリック（選択）として扱います。
   * @param {PointerEvent} e イベントです。
   */
  handlePointerUp(e) {
    const d = this.drag;
    this.drag = null;
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.type === 'node') {
      d.node.pinned = false;
      if (!d.moved && e.type === 'pointerup') {
        const now = performance.now();
        const isDouble = this.lastClick.id === d.node.id && now - this.lastClick.time < 350;
        this.lastClick = { id: isDouble ? null : d.node.id, time: now };
        this.callbacks.onSelect(d.node.id);
        if (isDouble) this.callbacks.onActivate(d.node.id);
      }
    } else if (!d.moved && e.type === 'pointerup') {
      this.callbacks.onSelect(null);
    }
  }

  /**
   * ホイールでカーソル位置を中心に拡大・縮小します。
   * @param {WheelEvent} e イベントです。
   */
  handleWheel(e) {
    e.preventDefault();
    const rect = this.svg.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x, y, k } = this.transform;
    const nk = Math.min(3, Math.max(0.25, k * Math.exp(-e.deltaY * 0.0015)));
    // カーソル下のマップ座標が動かないよう平行移動量を補正します。
    this.transform = { x: sx - ((sx - x) / k) * nk, y: sy - ((sy - y) / k) * nk, k: nk };
    this.applyTransform();
  }

  /**
   * すべてのノードが画面内に収まるよう、拡大率と位置を調整します。
   * ノードが無い場合は resetView() と同じ動作です。
   */
  fitAll() {
    const nodes = [...this.model.nodes.values()];
    if (nodes.length === 0) {
      this.resetView();
      return;
    }
    const rect = this.svg.getBoundingClientRect();
    const pad = 70;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    const k = Math.min(1.5, Math.max(0.25, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY))));
    this.transform = {
      x: rect.width / 2 - ((minX + maxX) / 2) * k,
      y: rect.height / 2 - ((minY + maxY) / 2) * k,
      k,
    };
    this.applyTransform();
  }

  /**
   * 拡大率をボタン操作で変更します（画面中央を基準にします）。
   * @param {number} factor 掛ける倍率です。
   */
  zoomBy(factor) {
    const rect = this.svg.getBoundingClientRect();
    const sx = rect.width / 2;
    const sy = rect.height / 2;
    const { x, y, k } = this.transform;
    const nk = Math.min(3, Math.max(0.25, k * factor));
    this.transform = { x: sx - ((sx - x) / k) * nk, y: sy - ((sy - y) / k) * nk, k: nk };
    this.applyTransform();
  }

  /**
   * 指定ノードが画面中央に来るように平行移動します。
   * @param {number} id ノード ID です。
   */
  centerOn(id) {
    const node = this.model.nodes.get(id);
    if (!node) return;
    const rect = this.svg.getBoundingClientRect();
    this.transform.x = rect.width / 2 - node.x * this.transform.k;
    this.transform.y = rect.height / 2 - node.y * this.transform.k;
    this.applyTransform();
  }

  /**
   * 選択中のノードを設定し、強調表示を更新します。
   * @param {number|null} id ノード ID（選択解除なら null）です。
   */
  setSelected(id) {
    this.selectedId = id;
    this.updateHighlight();
  }

  /**
   * モデルの構造（ノード・エッジの増減）を SVG 要素に反映します。
   * 既存のノード要素は再利用し、位置以外の再生成を最小限にします。
   */
  renderStructure() {
    // エッジは数が少ないため毎回作り直します。
    this.edgeLayer.replaceChildren();
    this.edgeEls = this.model.edges.map((edge) => {
      const el = this.createEl('line', { class: `edge rel-${edge.relation}`, stroke: RELATIONS[edge.relation].color });
      this.edgeLayer.append(el);
      return { el, edge };
    });

    // 削除されたノード、または同じ ID で別の単語に置き換わったノード（読み込み時など）の要素を取り除きます。
    for (const [id, el] of this.nodeEls) {
      const current = this.model.nodes.get(id);
      if (!current || current.word !== el.dataset.word) {
        el.remove();
        this.nodeEls.delete(id);
      }
    }
    // 新しいノードの要素を作ります。
    for (const node of this.model.nodes.values()) {
      if (this.nodeEls.has(node.id)) continue;
      const g = this.createEl('g', { class: 'node', 'data-id': String(node.id), 'data-word': node.word, tabindex: '0', role: 'button' });
      const width = Math.max(48, node.word.length * 9 + 28);
      const rect = this.createEl('rect', { x: String(-width / 2), y: '-17', width: String(width), height: '34', rx: '17' });
      const text = this.createEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      text.textContent = node.word;
      const title = this.createEl('title');
      title.textContent = `${node.word}（クリックで選択・ダブルクリックで発音）`;
      g.append(title, rect, text);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.callbacks.onSelect(node.id);
        }
      });
      this.nodeLayer.append(g);
      this.nodeEls.set(node.id, g);
    }
    if (this.selectedId != null && !this.model.nodes.has(this.selectedId)) this.selectedId = null;
    this.updatePositions();
    this.updateHighlight();
  }

  /** ノードとエッジの位置だけを更新します（レイアウト計算の毎フレームで呼ばれます）。 */
  updatePositions() {
    for (const [id, el] of this.nodeEls) {
      const n = this.model.nodes.get(id);
      if (n) el.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    }
    for (const { el, edge } of this.edgeEls) {
      const s = this.model.nodes.get(edge.source);
      const t = this.model.nodes.get(edge.target);
      if (!s || !t) continue;
      el.setAttribute('x1', s.x.toFixed(1));
      el.setAttribute('y1', s.y.toFixed(1));
      el.setAttribute('x2', t.x.toFixed(1));
      el.setAttribute('y2', t.y.toFixed(1));
    }
  }

  /** 選択ノードとその隣接ノード・エッジを強調し、それ以外を薄く表示します。 */
  updateHighlight() {
    const sel = this.selectedId;
    const near = new Set();
    if (sel != null) {
      near.add(sel);
      for (const { node } of this.model.neighbors(sel)) near.add(node.id);
    }
    for (const [id, el] of this.nodeEls) {
      el.classList.toggle('selected', id === sel);
      el.classList.toggle('dimmed', sel != null && !near.has(id));
    }
    for (const { el, edge } of this.edgeEls) {
      const active = sel != null && (edge.source === sel || edge.target === sel);
      el.classList.toggle('active', active);
      el.classList.toggle('dimmed', sel != null && !active);
    }
  }
}
