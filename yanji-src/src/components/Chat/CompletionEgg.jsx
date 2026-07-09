import { useEffect, useState } from 'react'

// 完成彩蛋：回复结束后小概率（约1%）右下角冒出一只像素小家伙，点一下消失。
// Clawd 像素画来自 chatnest（MIT License, github.com/ugui3u/chatnest），乌鸦是照同款风格自绘的。

const CLAWD_COFFEE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45">
  <defs><style>
    .cf-body{transform-origin:7.5px 13px;animation:cf-sip 3.4s infinite ease-in-out;}
    .cf-shad{transform-origin:7.5px 15.5px;animation:cf-shadow 3.4s infinite ease-in-out;}
    .cf-eye {transform-origin:7.5px 9px;animation:cf-blink 3s infinite;}
    .cf-steam{opacity:0;animation:cf-steam 2.4s var(--sd,0s) infinite ease-in;}
    @keyframes cf-sip{0%,55%,100%{transform:rotate(0) translateY(0);}72%{transform:rotate(-7deg) translateY(-1px);}88%{transform:rotate(0) translateY(0);}}
    @keyframes cf-shadow{0%,100%{transform:scaleX(1);opacity:.5;}72%{transform:scaleX(.93);opacity:.44;}}
    @keyframes cf-blink{0%,46%,54%,100%{transform:scaleY(1);}50%{transform:scaleY(.1);}}
    @keyframes cf-steam{0%{opacity:0;transform:translate(0,0) scaleX(1);}30%{opacity:.6;}100%{opacity:0;transform:translate(var(--tx,1px),-8px) scaleX(.5);}}
  </style></defs>
  <rect class="cf-shad" x="3" y="15" width="9" height="1" fill="#000" opacity=".5"/>
  <g class="cf-body">
    <g fill="#DE886D">
      <rect x="3" y="13" width="1" height="2"/><rect x="5" y="13" width="1" height="2"/>
      <rect x="9" y="13" width="1" height="2"/><rect x="11" y="13" width="1" height="2"/>
    </g>
    <rect x="2" y="6" width="11" height="7" fill="#DE886D"/>
    <g class="cf-eye" fill="#000"><rect x="4" y="8" width="1" height="2"/><rect x="10" y="8" width="1" height="2"/></g>
    <rect x="6.4" y="10.8" width="2.2" height="1" rx=".5" fill="#7a2230"/>
    <rect x="0.4" y="10" width="2" height="2.2" rx=".3" fill="#DE886D" transform="rotate(40,1.4,11)"/>
    <rect x="12.6" y="10" width="2" height="2.2" rx=".3" fill="#DE886D" transform="rotate(-40,13.6,11)"/>
    <g fill="#fff">
      <rect class="cf-steam" style="--sd:0s;--tx:-1px" x="5.6" y="8.2" width=".7" height="2.4" rx=".35"/>
      <rect class="cf-steam" style="--sd:-1.2s;--tx:1px" x="8" y="8.2" width=".7" height="2.4" rx=".35"/>
    </g>
    <g>
      <path d="M11 11 q2.4 .2 2.4 1.6 q0 1.5 -2.4 1.4" fill="none" stroke="#efe9df" stroke-width=".9"/>
      <rect x="4" y="10.4" width="7" height="3.6" rx=".7" fill="#efe9df"/>
      <rect x="4" y="10.4" width="7" height="1" rx=".7" fill="#fff"/>
      <ellipse cx="7.5" cy="10.7" rx="2.9" ry=".8" fill="#5b3a22"/>
    </g>
  </g>
</svg>`

const CLAWD_MUSIC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45">
  <defs><style>
    .lm-body{transform-origin:7.5px 13px;animation:lm-groove 1.1s infinite ease-in-out;}
    .lm-shad{transform-origin:7.5px 15.5px;animation:lm-shadow 1.1s infinite ease-in-out;}
    .lm-eye {transform-origin:7.5px 9px;animation:lm-blink 3s infinite;}
    .lm-al  {transform-origin:2px 10px;animation:lm-tap-l .55s infinite alternate ease-in-out;}
    .lm-ar  {transform-origin:13px 10px;animation:lm-tap-r .55s infinite alternate ease-in-out;}
    .lm-note{opacity:0;animation:lm-note var(--d,2s) var(--delay,0s) infinite ease-out;}
    @keyframes lm-groove{0%,100%{transform:rotate(-3deg) translateY(0);}50%{transform:rotate(3deg) translateY(-1px);}}
    @keyframes lm-shadow{0%,100%{transform:scaleX(1);opacity:.5;}50%{transform:scaleX(.9);opacity:.42;}}
    @keyframes lm-blink{0%,46%,54%,100%{transform:scaleY(1);}50%{transform:scaleY(.1);}}
    @keyframes lm-tap-l{0%{transform:rotate(0);}100%{transform:rotate(22deg);}}
    @keyframes lm-tap-r{0%{transform:rotate(0);}100%{transform:rotate(-22deg);}}
    @keyframes lm-note{0%{opacity:0;transform:translate(0,0) rotate(0);}15%{opacity:1;}80%{opacity:.85;}100%{opacity:0;transform:translate(var(--tx,4px),-19px) rotate(var(--r,20deg));}}
  </style></defs>
  <g>
    <g class="lm-note" style="--delay:0s;--d:1.9s;--tx:6px;--r:25deg" transform="translate(13,-2)" fill="#a98cff"><ellipse cx="0" cy="2" rx="1.1" ry=".85"/><rect x="1" y="-2" width=".7" height="4"/><rect x="1" y="-2" width="2.2" height=".8"/></g>
    <g class="lm-note" style="--delay:-.7s;--d:2.2s;--tx:-5px;--r:-20deg" transform="translate(-2,-1)" fill="#c0a6ff"><ellipse cx="0" cy="1.6" rx=".9" ry=".7"/><rect x=".8" y="-1.6" width=".6" height="3.4"/></g>
    <g class="lm-note" style="--delay:-1.3s;--d:2s;--tx:4px;--r:15deg" transform="translate(9,-3)" fill="#8c6cff"><ellipse cx="0" cy="1.6" rx="1" ry=".75"/><rect x=".9" y="-1.8" width=".6" height="3.6"/><rect x=".9" y="-1.8" width="1.8" height=".7"/></g>
  </g>
  <rect class="lm-shad" x="3" y="15" width="9" height="1" fill="#000" opacity=".5"/>
  <g class="lm-body">
    <g fill="#DE886D">
      <rect x="3" y="13" width="1" height="2"/><rect x="5" y="13" width="1" height="2"/>
      <rect x="9" y="13" width="1" height="2"/><rect x="11" y="13" width="1" height="2"/>
    </g>
    <rect x="2" y="6" width="11" height="7" fill="#DE886D"/>
    <g class="lm-al"><rect x="0" y="9" width="2" height="2" fill="#DE886D"/></g>
    <g class="lm-ar"><rect x="13" y="9" width="2" height="2" fill="#DE886D"/></g>
    <path d="M1 6 Q7.5 -.5 14 6" stroke="#2b2b35" stroke-width="1.5" fill="none"/>
    <rect x="-.4" y="6.2" width="2.6" height="3.6" rx=".9" fill="#33333f"/>
    <rect x="12.8" y="6.2" width="2.6" height="3.6" rx=".9" fill="#33333f"/>
    <rect x=".1" y="6.8" width="1.6" height="2.4" rx=".6" fill="#6a5ad0"/>
    <rect x="13.3" y="6.8" width="1.6" height="2.4" rx=".6" fill="#6a5ad0"/>
    <g class="lm-eye" fill="#000"><rect x="4" y="8" width="1" height="2"/><rect x="10" y="8" width="1" height="2"/></g>
  </g>
</svg>`

// 像素乌鸦·爱心版：黑羽小乌鸦左右摇摆，头顶冒粉色小爱心
const CROW_HEART = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45">
  <defs><style>
    .ch-body{transform-origin:7.5px 13px;animation:ch-bob 1.4s infinite ease-in-out;}
    .ch-shad{transform-origin:7.5px 15.5px;animation:ch-shadow 1.4s infinite ease-in-out;}
    .ch-eye {transform-origin:7.5px 9px;animation:ch-blink 3.2s infinite;}
    .ch-wl  {transform-origin:2px 10px;animation:ch-flap-l .7s infinite alternate ease-in-out;}
    .ch-wr  {transform-origin:13px 10px;animation:ch-flap-r .7s infinite alternate ease-in-out;}
    .ch-heart{opacity:0;animation:ch-heart var(--d,2.2s) var(--delay,0s) infinite ease-out;}
    @keyframes ch-bob{0%,100%{transform:rotate(-2.5deg) translateY(0);}50%{transform:rotate(2.5deg) translateY(-1px);}}
    @keyframes ch-shadow{0%,100%{transform:scaleX(1);opacity:.5;}50%{transform:scaleX(.9);opacity:.42;}}
    @keyframes ch-blink{0%,46%,54%,100%{transform:scaleY(1);}50%{transform:scaleY(.1);}}
    @keyframes ch-flap-l{0%{transform:rotate(0);}100%{transform:rotate(18deg);}}
    @keyframes ch-flap-r{0%{transform:rotate(0);}100%{transform:rotate(-18deg);}}
    @keyframes ch-heart{0%{opacity:0;transform:translate(0,0) scale(.7);}15%{opacity:1;transform:scale(1);}80%{opacity:.85;}100%{opacity:0;transform:translate(var(--tx,3px),-18px) scale(.8);}}
  </style></defs>
  <g fill="#e8788a">
    <path class="ch-heart" style="--delay:0s;--d:2.1s;--tx:5px" transform="translate(12,-1)" d="M2 3.4 C.7 2.4 .1 1.6 .1 1 A1 1 0 0 1 2 .7 A1 1 0 0 1 3.9 1 C3.9 1.6 3.3 2.4 2 3.4Z"/>
    <path class="ch-heart" style="--delay:-.8s;--d:2.4s;--tx:-4px" transform="translate(0,0) scale(.8)" d="M2 3.4 C.7 2.4 .1 1.6 .1 1 A1 1 0 0 1 2 .7 A1 1 0 0 1 3.9 1 C3.9 1.6 3.3 2.4 2 3.4Z" fill="#f0a0ae"/>
    <path class="ch-heart" style="--delay:-1.5s;--d:2.2s;--tx:3px" transform="translate(8,-3) scale(.9)" d="M2 3.4 C.7 2.4 .1 1.6 .1 1 A1 1 0 0 1 2 .7 A1 1 0 0 1 3.9 1 C3.9 1.6 3.3 2.4 2 3.4Z"/>
  </g>
  <rect class="ch-shad" x="3" y="15" width="9" height="1" fill="#000" opacity=".5"/>
  <g class="ch-body">
    <g fill="#DA7756">
      <rect x="4.5" y="13" width="1" height="2"/><rect x="9.5" y="13" width="1" height="2"/>
    </g>
    <rect x="2" y="6" width="11" height="7" fill="#2E2B29"/>
    <rect x="5.5" y="5" width="4" height="1" fill="#2E2B29"/>
    <rect x="6.5" y="4.2" width="1" height="1" fill="#2E2B29"/>
    <g class="ch-wl"><rect x="0" y="9" width="2" height="2.4" fill="#211F1D"/></g>
    <g class="ch-wr"><rect x="13" y="9" width="2" height="2.4" fill="#211F1D"/></g>
    <g class="ch-eye" fill="#F5F0E8"><rect x="4" y="8" width="1.2" height="1.8"/><rect x="9.8" y="8" width="1.2" height="1.8"/></g>
    <path d="M6.7 10.6 L8.3 10.6 L7.5 12 Z" fill="#DA7756"/>
  </g>
</svg>`

// 像素乌鸦·瞌睡版：闭眼小乌鸦慢慢起伏，头顶飘 z z z
const CROW_SLEEP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45">
  <defs><style>
    .cs-body{transform-origin:7.5px 13px;animation:cs-breath 3s infinite ease-in-out;}
    .cs-shad{transform-origin:7.5px 15.5px;animation:cs-shadow 3s infinite ease-in-out;}
    .cs-z{opacity:0;animation:cs-z var(--d,2.8s) var(--delay,0s) infinite ease-out;}
    @keyframes cs-breath{0%,100%{transform:scaleY(1) translateY(0);}50%{transform:scaleY(.94) translateY(.5px);}}
    @keyframes cs-shadow{0%,100%{transform:scaleX(1);opacity:.5;}50%{transform:scaleX(.96);opacity:.45;}}
    @keyframes cs-z{0%{opacity:0;transform:translate(0,0);}18%{opacity:.9;}80%{opacity:.7;}100%{opacity:0;transform:translate(var(--tx,4px),-16px);}}
  </style></defs>
  <g stroke="#8a86c8" stroke-width=".6" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path class="cs-z" style="--delay:0s;--d:2.8s;--tx:5px" transform="translate(12,0)" d="M0 0 H2.2 L0 2.2 H2.2"/>
    <path class="cs-z" style="--delay:-1s;--d:3s;--tx:3px" transform="translate(10,-3) scale(.75)" d="M0 0 H2.2 L0 2.2 H2.2"/>
    <path class="cs-z" style="--delay:-2s;--d:2.6s;--tx:6px" transform="translate(14,-2) scale(.55)" d="M0 0 H2.2 L0 2.2 H2.2"/>
  </g>
  <rect class="cs-shad" x="3" y="15" width="9" height="1" fill="#000" opacity=".5"/>
  <g class="cs-body">
    <rect x="2" y="7" width="11" height="6" fill="#2E2B29"/>
    <rect x="5.5" y="6" width="4" height="1" fill="#2E2B29"/>
    <rect x="0.6" y="9.5" width="1.6" height="2" fill="#211F1D"/>
    <rect x="12.8" y="9.5" width="1.6" height="2" fill="#211F1D"/>
    <g stroke="#F5F0E8" stroke-width=".7" stroke-linecap="round">
      <line x1="4" y1="9.4" x2="5.2" y2="9.4"/><line x1="9.8" y1="9.4" x2="11" y2="9.4"/>
    </g>
    <path d="M6.7 10.8 L8.3 10.8 L7.5 12.1 Z" fill="#DA7756"/>
  </g>
</svg>`

const EGG_POOL = [CLAWD_COFFEE, CLAWD_MUSIC, CROW_HEART, CROW_SLEEP]

// 每次回复完成后调用：约 4% 概率返回一只小家伙，其余时候 null
// （原 1%+4.9s 停留，阿颖聊了一周从没见过——期望太低，0709 调成 4%+8s）
export function pickEgg(prob = 0.04) {
  if (Math.random() >= prob) return null
  return EGG_POOL[Math.floor(Math.random() * EGG_POOL.length)]
}

export default function CompletionEgg({ svg, onDone }) {
  const [fading, setFading] = useState(false)
  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), 7300)
    const t2 = setTimeout(() => onDone?.(), 8000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [onDone])
  return (
    <div
      className={'completion-egg' + (fading ? ' fade-out' : '')}
      onClick={() => onDone?.()}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
