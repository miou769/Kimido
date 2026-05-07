<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#009e96">
  <title>きみまろ道場 - 司法書士民法</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E⚖%3C/text%3E%3C/svg%3E">

  <!-- React 18 + ReactDOM 18 + Babel Standalone (CDN) -->
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>

  <style>
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body { margin: 0; padding: 0; }
    body {
      background: #eaf9f7;
      font-family: 'Hiragino Kaku Gothic Pro','Noto Sans JP','Yu Gothic','Meiryo',sans-serif;
      color: #1a3835;
      overscroll-behavior: none;
    }
    select, button, input, textarea {
      -webkit-appearance: none;
      appearance: none;
      font-family: inherit;
    }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-thumb { background: #a8ddd8; border-radius: 2px; }
    #loading {
      position: fixed; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      background: #eaf9f7; color: #009e96;
      font-size: 14px; z-index: 9999;
    }
    #loading .spinner {
      width: 40px; height: 40px;
      border: 3px solid #a8ddd8;
      border-top-color: #009e96;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    #error {
      padding: 20px; color: #d4721a;
      font-size: 13px; line-height: 1.6;
      background: #fff8f0;
      border: 1px solid #f0c896;
      border-radius: 8px;
      margin: 20px;
    }
  </style>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <div>⚖ きみまろ道場 読み込み中...</div>
  </div>
  <div id="root"></div>

  <script>
    // kimido.jsx を読み込んでBabelで変換 → 実行
    fetch('kimido.jsx')
      .then(res => {
        if (!res.ok) throw new Error('kimido.jsx が見つからないちゃむ (HTTP ' + res.status + ')');
        return res.text();
      })
      .then(jsxText => {
        // ① import 文を削除（CDNでReactを読み込んでいるから不要）
        let code = jsxText.replace(/^\s*import\s+.*?from\s+["'].*?["'];?\s*$/gm, '');
        // ② export default を削除
        code = code.replace(/export\s+default\s+/g, '');
        // ③ React Hooks を window から取り出す
        code = 'const { useState, useEffect, useRef } = React;\n' + code;
        // ④ 末尾にレンダリング処理を追加
        code += '\nReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));';

        // ⑤ Babelで JSX → JS に変換
        const compiled = Babel.transform(code, { presets: ['react'] }).code;

        // ⑥ ローディング表示を消す
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';

        // ⑦ 実行
        const script = document.createElement('script');
        script.text = compiled;
        document.body.appendChild(script);
      })
      .catch(err => {
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';
        document.getElementById('root').innerHTML =
          '<div id="error"><b>エラー：</b><br>' + err.message +
          '<br><br>kimido.jsx と kimido.html が同じフォルダに置かれているか確認してちゃむ🌸</div>';
        console.error(err);
      });
  </script>
</body>
</html>
