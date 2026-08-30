// NEXUS ARMOR — procedural canvas textures. Zero asset downloads (DR-05).
import * as THREE from 'three'
import type { MapDef } from '../core/types'

function canvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')!
  return { c, g }
}

export function makeGroundTexture(map: MapDef): THREE.CanvasTexture {
  const { c, g } = canvas(512)
  const t = map.theme
  g.fillStyle = '#' + t.ground.toString(16).padStart(6, '0')
  g.fillRect(0, 0, 512, 512)

  // large soft patches of alternate tone
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    const r = 40 + Math.random() * 110
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, '#' + t.groundAlt.toString(16).padStart(6, '0') + '55')
    grad.addColorStop(1, '#00000000')
    g.fillStyle = grad
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  // speckle noise
  for (let i = 0; i < 5200; i++) {
    const v = Math.random()
    g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)'
    g.fillRect(Math.random() * 512, Math.random() * 512, 1.6, 1.6)
  }
  // faint panel grid
  g.strokeStyle = '#' + t.grid.toString(16).padStart(6, '0') + '44'
  g.lineWidth = 2
  for (let i = 0; i <= 8; i++) {
    const p = (i / 8) * 512
    g.beginPath()
    g.moveTo(p, 0)
    g.lineTo(p, 512)
    g.stroke()
    g.beginPath()
    g.moveTo(0, p)
    g.lineTo(512, p)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

export function makeSoftCircleTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(64)
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.5)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function makeFlashTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(128)
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62)
  grad.addColorStop(0, 'rgba(255,255,240,1)')
  grad.addColorStop(0.25, 'rgba(255,220,140,0.9)')
  grad.addColorStop(0.6, 'rgba(255,150,60,0.35)')
  grad.addColorStop(1, 'rgba(255,120,40,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  // star spikes
  g.strokeStyle = 'rgba(255,240,200,0.9)'
  g.lineWidth = 5
  g.lineCap = 'round'
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI + Math.PI / 8
    g.beginPath()
    g.moveTo(64 - Math.cos(a) * 52, 64 - Math.sin(a) * 52)
    g.lineTo(64 + Math.cos(a) * 52, 64 + Math.sin(a) * 52)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function makeReticleTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(128)
  g.strokeStyle = 'rgba(255,210,120,0.95)'
  g.lineWidth = 5
  g.beginPath()
  g.arc(64, 64, 44, 0, Math.PI * 2)
  g.stroke()
  g.lineWidth = 4
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    g.beginPath()
    g.moveTo(64 + Math.cos(a) * 30, 64 + Math.sin(a) * 30)
    g.lineTo(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50)
    g.stroke()
  }
  g.fillStyle = 'rgba(255,210,120,0.95)'
  g.beginPath()
  g.arc(64, 64, 5, 0, Math.PI * 2)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function makeScorchTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(128)
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 62)
  grad.addColorStop(0, 'rgba(10,8,6,0.9)')
  grad.addColorStop(0.55, 'rgba(15,12,10,0.55)')
  grad.addColorStop(1, 'rgba(20,16,12,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 160; i++) {
    const a = Math.random() * Math.PI * 2
    const r = 20 + Math.random() * 42
    g.fillStyle = `rgba(5,4,3,${0.25 + Math.random() * 0.3})`
    g.fillRect(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 3, 3)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function makeTreadTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(64)
  g.fillStyle = 'rgba(20,18,14,0.55)'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = 'rgba(0,0,0,0.35)'
  for (let i = 0; i < 8; i++) g.fillRect(i * 8, 0, 4, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function makeHealthBarTexture(): { bg: THREE.CanvasTexture; fg: THREE.CanvasTexture } {
  const bg = canvas(64)
  bg.g.fillStyle = 'rgba(0,0,0,0.65)'
  bg.g.fillRect(0, 0, 64, 12)
  const fg = canvas(64)
  fg.g.fillStyle = '#7bd88f'
  fg.g.fillRect(0, 0, 64, 12)
  const bgT = new THREE.CanvasTexture(bg.c)
  const fgT = new THREE.CanvasTexture(fg.c)
  bgT.colorSpace = THREE.SRGBColorSpace
  fgT.colorSpace = THREE.SRGBColorSpace
  return { bg: bgT, fg: fgT }
}
