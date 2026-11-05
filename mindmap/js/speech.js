/**
 * speech.js
 * 音声入力（Web Speech API の SpeechRecognition）と
 * 読み上げ（SpeechSynthesis）をラップするクラスです。
 */

/**
 * 音声認識のラッパーです。
 * Chrome / Edge では webkitSpeechRecognition として提供されるため、両方の名前を確認します。
 */
class SpeechInput {
  /**
   * @param {object} handlers
   * @param {string} [handlers.lang] 認識する言語です（既定は 'en-US'）。
   * @param {(alternatives: string[]) => void} handlers.onFinal 確定結果の候補（信頼度順）を受け取ります。
   * @param {(text: string) => void} [handlers.onInterim] 認識途中の文字列を受け取ります。
   * @param {(listening: boolean) => void} [handlers.onStateChange] 認識中かどうかの変化を受け取ります。
   * @param {(message: string) => void} [handlers.onError] 利用者向けのエラーメッセージを受け取ります。
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.lang = handlers.lang || 'en-US';
    this.listening = false;
    this.recognition = null;
    const Ctor = SpeechInput.getConstructor();
    if (Ctor) this.setup(new Ctor());
  }

  /**
   * ブラウザが提供する SpeechRecognition コンストラクタを返します。
   * @returns {Function|null} コンストラクタです。未対応なら null です。
   */
  static getConstructor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  /**
   * 音声認識が使えるかを返します。
   * @returns {boolean} 使える場合は true です。
   */
  isSupported() {
    return this.recognition !== null;
  }

  /**
   * 認識オブジェクトの設定とイベント登録を行います。
   * 1回の発話ごとに確定させる設定（continuous = false）にしています。
   * @param {object} rec SpeechRecognition のインスタンスです。
   */
  setup(rec) {
    rec.lang = this.lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    rec.onstart = () => this.setListening(true);
    rec.onend = () => this.setListening(false);
    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const alternatives = [];
          for (let j = 0; j < result.length; j++) alternatives.push(result[j].transcript);
          this.handlers.onFinal(alternatives);
        } else {
          interim += result[0].transcript;
        }
      }
      if (interim && this.handlers.onInterim) this.handlers.onInterim(interim);
    };
    rec.onerror = (event) => {
      if (this.handlers.onError) this.handlers.onError(SpeechInput.describeError(event.error));
    };
    this.recognition = rec;
  }

  /**
   * エラーコードを利用者向けの日本語メッセージへ変換します。
   * @param {string} code SpeechRecognitionErrorEvent.error の値です。
   * @returns {string} 表示用メッセージです。
   */
  static describeError(code) {
    const messages = {
      'no-speech': '音声が検出されませんでした。もう一度話してください。',
      'audio-capture': 'マイクが見つかりません。接続を確認してください。',
      'not-allowed': 'マイクの使用が許可されていません。ブラウザの設定で許可してください。',
      'service-not-allowed': 'このブラウザ・環境では音声認識サービスが使えません。',
      network: '音声認識サービスに接続できませんでした（ネットワークを確認してください）。',
      aborted: '音声入力を中断しました。',
      'language-not-supported': '指定した言語は音声認識に対応していません。',
    };
    return messages[code] || `音声認識エラー: ${code}`;
  }

  /**
   * 認識状態を更新し、購読者へ通知します。
   * @param {boolean} value 認識中なら true です。
   */
  setListening(value) {
    this.listening = value;
    if (this.handlers.onStateChange) this.handlers.onStateChange(value);
  }

  /** 認識を開始します。既に開始している場合は何もしません。 */
  start() {
    if (!this.recognition || this.listening) return;
    try {
      this.recognition.start();
    } catch (err) {
      // 連続クリックなどで既に開始済みの場合、InvalidStateError が投げられます。
      if (this.handlers.onError) this.handlers.onError('音声入力を開始できませんでした。少し待ってから再度お試しください。');
    }
  }

  /** 認識を停止します。話し終えた分は確定結果として返されます。 */
  stop() {
    if (this.recognition && this.listening) this.recognition.stop();
  }

  /** 認識の開始と停止を切り替えます。 */
  toggle() {
    if (this.listening) this.stop();
    else this.start();
  }
}

/**
 * 英単語の読み上げを担当するクラスです。
 */
class Speaker {
  /**
   * @param {string} [lang] 読み上げ言語です（既定は 'en-US'）。
   */
  constructor(lang = 'en-US') {
    this.lang = lang;
    this.synth = window.speechSynthesis || null;
  }

  /**
   * 読み上げが使えるかを返します。
   * @returns {boolean} 使える場合は true です。
   */
  isSupported() {
    return this.synth !== null && typeof window.SpeechSynthesisUtterance === 'function';
  }

  /**
   * 指定した文字列を読み上げます。前の読み上げは中断します。
   * @param {string} text 読み上げる文字列です。
   */
  speak(text) {
    if (!this.isSupported() || !text) return;
    this.synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = this.lang;
    utter.rate = 0.9;
    this.synth.speak(utter);
  }
}
