// A tiny, dependency-free highlighter for the code windows. It escapes first, then wraps comments, strings, numbers and a short keyword list. Output is plain HTML spans that already exist in the first response.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const KW = /\b(import|from|const|let|var|await|async|return|new|if|else|for|func|package|def|class|public|static|void|string|use|fn|print|echo|require|export|function|try|catch|throw|type|interface|struct|using|var|var)\b/g;
export function hl(code) {
  const out = []; const re = /(\/\/[^\n]*|#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g; let last = 0, m;
  const plain = (t) => esc(t).replace(KW, '<i class="k">$1</i>').replace(/\b(\d+(?:\.\d+)?)\b/g, '<i class="n">$1</i>');
  while ((m = re.exec(code))) { out.push(plain(code.slice(last, m.index))); out.push(m[1] ? `<i class="c">${esc(m[1])}</i>` : `<i class="s">${esc(m[2])}</i>`); last = re.lastIndex; }
  out.push(plain(code.slice(last))); return out.join("");
}
