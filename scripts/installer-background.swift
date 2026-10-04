import AppKit
let width = 640, height = 420
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor(calibratedWhite: 0.065, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()
func text(_ value: String, y: CGFloat, size: CGFloat, shade: CGFloat, weight: NSFont.Weight = .regular) {
    let style = NSMutableParagraphStyle(); style.alignment = .center
    (value as NSString).draw(in: NSRect(x: 30, y: y, width: 580, height: size * 1.6), withAttributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: NSColor(calibratedWhite: shade, alpha: 1), .paragraphStyle: style])
}
text("A little help. Right at home.", y: 322, size: 26, shade: 0.93, weight: .medium)
text("Drag cue into Applications to get started.", y: 287, size: 13, shade: 0.55)
for x: CGFloat in [100, 420] {
    NSColor(calibratedWhite: 0.105, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: x, y: 138, width: 120, height: 120), xRadius: 26, yRadius: 26).fill()
}
NSColor(calibratedWhite: 0.42, alpha: 1).setStroke()
let arrow = NSBezierPath(); arrow.lineWidth = 1.5
arrow.move(to: NSPoint(x: 292, y: 198)); arrow.line(to: NSPoint(x: 348, y: 198))
arrow.move(to: NSPoint(x: 340, y: 206)); arrow.line(to: NSPoint(x: 348, y: 198)); arrow.line(to: NSPoint(x: 340, y: 190)); arrow.stroke()
text("Say what you want done. Keep working.", y: 42, size: 12, shade: 0.45)
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
