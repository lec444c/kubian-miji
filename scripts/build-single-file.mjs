import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 将构建产物与运行时素材内联为单个 HTML，供双击离线试玩（file:// 协议）。
// 排除历史整套角色/动画库；格斗所需角色和11段动作位于 fight/，随其他运行时资源一起内联。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const publicAssets = path.join(root, 'public/assets');
const outDir = path.join(root, 'release');
const outFile = path.join(outDir, '库边秘技-试玩版.html');

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const jsMatch = html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/);
const cssMatch = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/);
if (!jsMatch || !cssMatch) throw new Error('dist/index.html 结构不符合预期');
const js = fs.readFileSync(path.join(dist, jsMatch[1]), 'utf8');
const css = fs.readFileSync(path.join(dist, cssMatch[1]), 'utf8');

const MIME = {
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.obj': 'text/plain', '.mtl': 'text/plain',
};
const entries = [];
const walk = dir => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name === 'characters' || name === 'animations') continue;
      walk(full);
    } else {
      const key = `/assets/${path.relative(publicAssets, full).split(path.sep).join('/')}`;
      const mime = MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
      entries.push([key, `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`]);
    }
  }
};
walk(publicAssets);
entries.sort((a, b) => a[0].localeCompare(b[0]));

const assetScript = `<script>
(function () {
  var ASSETS = {
${entries.map(([key, url]) => `    ${JSON.stringify(key)}: ${JSON.stringify(url)}`).join(',\n')}
  };
  function keyOf(url) {
    try {
      // file:// 下 pathname 带盘符（/D:/assets/…），归一化后再查表。
      return new URL(String(url), location.href).pathname.replace(/^\\/[A-Za-z]:/, '');
    } catch (error) { return null; }
  }
  var cache = {};
  function bytesOf(key) {
    if (!cache[key]) {
      var url = ASSETS[key];
      var bin = atob(url.slice(url.indexOf(',') + 1));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      cache[key] = bytes;
    }
    return cache[key];
  }
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var key = keyOf(typeof input === 'string' ? input : (input && input.url) || input);
    if (key && ASSETS[key]) {
      var url = ASSETS[key];
      return Promise.resolve(new Response(bytesOf(key), {
        status: 200,
        headers: { 'Content-Type': url.slice(5, url.indexOf(';')) },
      }));
    }
    return origFetch(input, init);
  };
  // Three.js ImageLoader 通过 img.src 加载贴图、BGM 通过 audio.src 加载音乐，
  // 两者同样映射到内联 data URL。
  function interceptSrc(proto) {
    var desc = Object.getOwnPropertyDescriptor(proto, 'src');
    if (!desc || !desc.set) return;
    Object.defineProperty(proto, 'src', {
      configurable: true,
      get: function () { return desc.get.call(this); },
      set: function (value) {
        var key = keyOf(value);
        desc.set.call(this, key && ASSETS[key] ? ASSETS[key] : value);
      },
    });
  }
  interceptSrc(HTMLImageElement.prototype);
  interceptSrc(HTMLMediaElement.prototype);
})();
</script>`;

// _bundle 含模板字面量 `$`（正则锚点），字符串替换会触发 $& / $` / $' 模式插值，
// 必须用函数替换原样内联。bundle 实测不含 <!-- 与 <script，仅需防 </script 提前闭合。
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const safeCss = css.replace(/<\/style/gi, '<\\/style');
const single = html
  .replace(jsMatch[0], () => `${assetScript}\n    <script type="module">${safeJs}</script>`)
  .replace(cssMatch[0], () => `<style>${safeCss}</style>`);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, single);
const bytes = fs.statSync(outFile).size;
console.log('SINGLE FILE', outFile, `${(bytes / 1024 / 1024).toFixed(1)} MB`, `assets=${entries.length}`);