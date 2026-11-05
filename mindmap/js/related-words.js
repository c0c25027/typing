/**
 * related-words.js
 * 関連語と英英定義を取得するサービス層です。
 * Datamuse API（https://api.datamuse.com/words、キー不要）を第一の取得元とし、
 * 通信できない場合は内蔵の小さなオフライン辞書に切り替えます。
 */

/**
 * 通信できない環境でも最低限動かすための内蔵辞書です。
 * 収録語は少数であり、網羅性はありません。
 */
const OFFLINE_DICTIONARY = Object.freeze({
  ocean: { trg: ['sea', 'wave', 'water', 'beach', 'fish', 'ship', 'deep', 'blue'], syn: ['sea', 'main'], ant: ['land'], ml: ['sea', 'marine', 'waters'] },
  sea: { trg: ['ocean', 'wave', 'salt', 'shore', 'sailor', 'tide'], syn: ['ocean'], ant: ['land'], ml: ['ocean', 'marine'] },
  water: { trg: ['drink', 'river', 'rain', 'ice', 'ocean', 'thirst'], syn: ['aqua'], ant: ['fire'], ml: ['liquid', 'fluid'] },
  happy: { trg: ['smile', 'joy', 'laugh', 'birthday', 'fun'], syn: ['glad', 'cheerful', 'joyful'], ant: ['sad', 'unhappy'], ml: ['pleased', 'content', 'delighted'] },
  sad: { trg: ['cry', 'tears', 'lonely', 'grief'], syn: ['unhappy', 'sorrowful'], ant: ['happy', 'glad'], ml: ['gloomy', 'upset', 'depressed'] },
  big: { trg: ['huge', 'giant', 'elephant', 'city'], syn: ['large', 'great'], ant: ['small', 'little'], ml: ['huge', 'enormous', 'vast'] },
  small: { trg: ['tiny', 'mouse', 'child', 'little'], syn: ['little', 'tiny'], ant: ['big', 'large'], ml: ['minor', 'compact'] },
  fast: { trg: ['car', 'speed', 'run', 'race'], syn: ['quick', 'rapid', 'swift'], ant: ['slow'], ml: ['speedy', 'hasty'] },
  slow: { trg: ['turtle', 'snail', 'traffic'], syn: ['sluggish'], ant: ['fast', 'quick'], ml: ['gradual', 'leisurely'] },
  school: { trg: ['teacher', 'student', 'class', 'study', 'exam', 'homework'], syn: ['academy'], ant: [], ml: ['college', 'university', 'institute'] },
  study: { trg: ['exam', 'book', 'school', 'learn', 'library'], syn: ['learn', 'research'], ant: [], ml: ['examine', 'review'] },
  learn: { trg: ['study', 'school', 'teach', 'knowledge'], syn: ['study', 'acquire'], ant: ['forget'], ml: ['discover', 'master'] },
  computer: { trg: ['keyboard', 'software', 'internet', 'program', 'screen'], syn: ['pc', 'machine'], ant: [], ml: ['laptop', 'processor'] },
  keyboard: { trg: ['typing', 'key', 'computer', 'piano'], syn: [], ant: [], ml: ['keypad'] },
  typing: { trg: ['keyboard', 'speed', 'letter', 'text'], syn: ['keying'], ant: [], ml: ['writing', 'input'] },
  music: { trg: ['song', 'piano', 'guitar', 'concert', 'sound'], syn: ['melody', 'tune'], ant: ['silence'], ml: ['song', 'harmony'] },
  food: { trg: ['eat', 'hungry', 'kitchen', 'restaurant', 'meal'], syn: ['meal', 'cuisine'], ant: [], ml: ['nutrition', 'dish'] },
  hot: { trg: ['summer', 'sun', 'fire', 'spicy'], syn: ['warm', 'heated'], ant: ['cold', 'cool'], ml: ['burning', 'boiling'] },
  cold: { trg: ['winter', 'ice', 'snow', 'freeze'], syn: ['chilly', 'cool'], ant: ['hot', 'warm'], ml: ['frozen', 'icy'] },
  light: { trg: ['sun', 'lamp', 'bright', 'day'], syn: ['brightness', 'glow'], ant: ['dark', 'heavy'], ml: ['illumination', 'shine'] },
  dark: { trg: ['night', 'shadow', 'black'], syn: ['dim', 'gloomy'], ant: ['light', 'bright'], ml: ['shadowy', 'murky'] },
  begin: { trg: ['start', 'first', 'open'], syn: ['start', 'commence'], ant: ['end', 'finish'], ml: ['initiate', 'launch'] },
  end: { trg: ['finish', 'last', 'final'], syn: ['finish', 'conclusion'], ant: ['begin', 'start'], ml: ['close', 'stop'] },
  friend: { trg: ['buddy', 'family', 'trust', 'party'], syn: ['companion', 'buddy', 'pal'], ant: ['enemy'], ml: ['ally', 'mate'] },
  travel: { trg: ['trip', 'airport', 'passport', 'hotel', 'journey'], syn: ['journey', 'tour'], ant: ['stay'], ml: ['voyage', 'trip'] },
});

/**
 * 関連語・定義の取得を担当します。結果は単語と関連種別ごとにメモリへキャッシュします。
 */
class RelatedWordService {
  /**
   * @param {object} [options]
   * @param {string} [options.endpoint] Datamuse の words エンドポイント URL です。
   * @param {number} [options.max] 1回に取得する候補数の上限です。
   * @param {number} [options.timeoutMs] 通信のタイムアウト（ミリ秒）です。
   * @param {Function} [options.fetchFn] fetch 互換の関数です（テスト時の差し替え用）。
   */
  constructor(options = {}) {
    this.endpoint = options.endpoint || 'https://api.datamuse.com/words';
    this.max = options.max || 12;
    this.timeoutMs = options.timeoutMs || 6000;
    this.fetchFn = options.fetchFn || ((...args) => window.fetch(...args));
    /** @type {Map<string, Promise<{words:string[], source:string}>>} */
    this.cache = new Map();
    /** @type {Map<string, Promise<string[]>>} */
    this.defCache = new Map();
  }

  /**
   * タイムアウト付きで JSON を取得します。
   * @param {URLSearchParams} params クエリパラメータです。
   * @returns {Promise<any[]>} API の応答配列です。
   * @throws {Error} 通信失敗・タイムアウト・HTTP エラーの場合です。
   */
  async fetchJson(params) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.endpoint}?${params.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('想定外の応答形式です。');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 候補語を単語として扱える形に整え、元の単語と重複を除きます。
   * 英字・ハイフン・アポストロフィのみから成る語（2語以内）だけを残します。
   * @param {string[]} list 候補語の配列です。
   * @param {string} word 元の単語です。
   * @returns {string[]} 整形後の候補語です。
   */
  sanitize(list, word) {
    const seen = new Set([word]);
    const out = [];
    for (const raw of list) {
      const w = MindMapModel.normalize(raw);
      if (!w || seen.has(w) || !/^[a-z][a-z'\-]*( [a-z][a-z'\-]*)?$/.test(w)) continue;
      seen.add(w);
      out.push(w);
      if (out.length >= this.max) break;
    }
    return out;
  }

  /**
   * 指定した関連種別の候補語を取得します。
   * API に失敗した場合はオフライン辞書の結果を返します（source: 'offline'）。
   * @param {string} text 対象の単語です。
   * @param {string} relation 関連種別（RELATIONS のキー。manual 以外）です。
   * @returns {Promise<{words: string[], source: 'api'|'offline'}>} 候補語と取得元です。
   */
  getRelated(text, relation) {
    const word = MindMapModel.normalize(text);
    const key = `${relation}:${word}`;
    if (!this.cache.has(key)) {
      const promise = this.loadRelated(word, relation).catch((err) => {
        // 失敗結果をキャッシュし続けないよう削除してから再送出します。
        this.cache.delete(key);
        throw err;
      });
      this.cache.set(key, promise);
    }
    return this.cache.get(key);
  }

  /**
   * getRelated の実処理です。キャッシュは扱いません。
   * @param {string} word 正規化済みの単語です。
   * @param {string} relation 関連種別です。
   * @returns {Promise<{words: string[], source: 'api'|'offline'}>}
   */
  async loadRelated(word, relation) {
    const def = RELATIONS[relation];
    if (!word || !def || !def.apiParam) return { words: [], source: 'offline' };
    try {
      const params = new URLSearchParams({ [def.apiParam]: word, max: String(this.max * 2) });
      const data = await this.fetchJson(params);
      return { words: this.sanitize(data.map((d) => d && d.word), word), source: 'api' };
    } catch (err) {
      const entry = OFFLINE_DICTIONARY[word];
      return { words: this.sanitize((entry && entry[relation]) || [], word), source: 'offline' };
    }
  }

  /**
   * 英英定義を取得します。Datamuse の md=d オプションを使います。
   * 定義は「品詞\t説明」の形式で返るため、表示用に「(品詞) 説明」へ整形します。
   * @param {string} text 対象の単語です。
   * @returns {Promise<string[]>} 定義の配列です（取得できなければ空配列）。
   */
  getDefinitions(text) {
    const word = MindMapModel.normalize(text);
    if (!this.defCache.has(word)) {
      const promise = (async () => {
        try {
          const params = new URLSearchParams({ sp: word, md: 'd', max: '1' });
          const data = await this.fetchJson(params);
          const hit = data.find((d) => d && d.word === word) || data[0];
          const defs = (hit && Array.isArray(hit.defs) ? hit.defs : []).slice(0, 3);
          return defs.map((d) => {
            const [pos, ...rest] = String(d).split('\t');
            return rest.length ? `(${pos}) ${rest.join(' ')}` : pos;
          });
        } catch (err) {
          this.defCache.delete(word);
          return [];
        }
      })();
      this.defCache.set(word, promise);
    }
    return this.defCache.get(word);
  }
}
