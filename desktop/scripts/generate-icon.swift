import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3 else {
  fputs("Usage: swift generate-icon.swift <Blok mascot PNG> <output PNG>\n", stderr)
  exit(1)
}

let source = CommandLine.arguments[1]
let output = CommandLine.arguments[2]
let size = 1024
let colorSpace = CGColorSpaceCreateDeviceRGB()

guard
  let mascot = NSImage(contentsOfFile: source),
  let image = mascot.cgImage(forProposedRect: nil, context: nil, hints: nil),
  let context = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  )
else {
  fputs("Could not load the Blok mascot or create the icon canvas.\n", stderr)
  exit(1)
}

context.clear(CGRect(x: 0, y: 0, width: size, height: size))
let face = CGPath(
  roundedRect: CGRect(x: 24, y: 24, width: 976, height: 976),
  cornerWidth: 216,
  cornerHeight: 216,
  transform: nil
)

context.saveGState()
context.addPath(face)
context.clip()
let colors = [
  CGColor(colorSpace: colorSpace, components: [1, 0.98, 0.96, 1])!,
  CGColor(colorSpace: colorSpace, components: [1, 0.92, 0.88, 1])!,
] as CFArray
let gradient = CGGradient(colorsSpace: colorSpace, colors: colors, locations: [0, 1])!
context.drawLinearGradient(
  gradient,
  start: CGPoint(x: 512, y: 1024),
  end: CGPoint(x: 512, y: 0),
  options: []
)
context.restoreGState()

context.interpolationQuality = .high
context.draw(image, in: CGRect(x: 110, y: 118, width: 804, height: 804))
context.addPath(face)
context.setStrokeColor(CGColor(colorSpace: colorSpace, components: [0.88, 0.73, 0.69, 0.5])!)
context.setLineWidth(2)
context.strokePath()

guard
  let result = context.makeImage(),
  let png = NSBitmapImageRep(cgImage: result).representation(using: .png, properties: [:])
else {
  fputs("Could not encode the icon PNG.\n", stderr)
  exit(1)
}

try png.write(to: URL(fileURLWithPath: output))
