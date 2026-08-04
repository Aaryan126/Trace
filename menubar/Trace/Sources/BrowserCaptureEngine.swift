import AppKit
import CoreGraphics
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers
import Vision

enum BrowserCaptureError: String, Error {
    case unsupportedSystem
    case browserNotFrontmost
    case privateWindow
    case noMatchingWindow
    case captureFailed
    case encodingFailed

    var reason: String {
        switch self {
        case .unsupportedSystem: return "unsupported_system"
        case .browserNotFrontmost: return "browser_not_frontmost"
        case .privateWindow: return "private_window"
        case .noMatchingWindow: return "no_matching_window"
        case .captureFailed: return "capture_failed"
        case .encodingFailed: return "encoding_failed"
        }
    }

    var message: String {
        switch self {
        case .unsupportedSystem: return "Requires macOS 14 or newer"
        case .browserNotFrontmost: return "Chrome or Safari was not frontmost"
        case .privateWindow: return "Private browser window skipped"
        case .noMatchingWindow: return "Active tab no longer matched the visit"
        case .captureFailed: return "macOS could not capture the browser window"
        case .encodingFailed: return "Screenshot encoding failed"
        }
    }
}

struct BrowserCaptureEngine {
    private static let supportedBrowsers = ["com.google.Chrome", "com.apple.Safari"]

    func capture(_ request: BrowserCaptureRequest) async throws -> BrowserCapturePayload {
        let startedAt = Date()
        func logStage(_ stage: String) {
            let elapsed = Date().timeIntervalSince(startedAt)
            let line = "[TraceCapture] \(stage) (\(String(format: "%.2f", elapsed))s)\n"
            if let data = line.data(using: .utf8) { FileHandle.standardError.write(data) }
        }
        logStage("started")
        guard #available(macOS 14.0, *) else { throw BrowserCaptureError.unsupportedSystem }
        guard let app = NSWorkspace.shared.frontmostApplication,
              let bundleId = app.bundleIdentifier,
              Self.supportedBrowsers.contains(bundleId) else {
            throw BrowserCaptureError.browserNotFrontmost
        }

        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        } catch {
            throw BrowserCaptureError.captureFailed
        }
        logStage("windows listed")
        guard let windowId = Self.frontmostWindowId(processIdentifier: app.processIdentifier),
              let window = content.windows.first(where: { $0.windowID == windowId && $0.owningApplication?.bundleIdentifier == bundleId }) else {
            throw BrowserCaptureError.noMatchingWindow
        }
        if Self.isPrivateWindowTitle(window.title ?? "") {
            throw BrowserCaptureError.privateWindow
        }
        guard Self.titleMatches(historyTitle: request.title, windowTitle: window.title ?? "") else {
            throw BrowserCaptureError.noMatchingWindow
        }

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let scale = min(2.0, 1_800.0 / max(window.frame.width, 1))
        let captured: CGImage
        if #available(macOS 26.0, *) {
            let configuration = SCScreenshotConfiguration()
            configuration.width = max(1, Int(window.frame.width * scale))
            configuration.height = max(1, Int(window.frame.height * scale))
            configuration.showsCursor = false
            configuration.ignoreShadows = true
            configuration.dynamicRange = .sdr
            do {
                let output = try await SCScreenshotManager.captureScreenshot(
                    contentFilter: filter,
                    configuration: configuration
                )
                guard let image = output.sdrImage else { throw BrowserCaptureError.captureFailed }
                captured = image
            } catch {
                throw BrowserCaptureError.captureFailed
            }
        } else {
            let configuration = SCStreamConfiguration()
            configuration.width = max(1, Int(window.frame.width * scale))
            configuration.height = max(1, Int(window.frame.height * scale))
            configuration.showsCursor = false
            configuration.capturesAudio = false
            do {
                captured = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
            } catch {
                throw BrowserCaptureError.captureFailed
            }
        }
        logStage("window captured")
        let cropped = cropBrowserChrome(captured) ?? captured
        guard let fullImage = resize(cropped, maximumWidth: 1_600),
              let thumbImage = resize(cropped, maximumWidth: 480),
              let fullData = encodeJPEG(fullImage, quality: 0.75),
              let thumbnailData = encodeJPEG(thumbImage, quality: 0.65) else {
            throw BrowserCaptureError.encodingFailed
        }
        let ocrImage = resize(cropped, maximumWidth: 1_000) ?? fullImage
        logStage("images encoded")
        let ocrText = recognizeText(in: ocrImage)
        logStage("OCR complete")

        return BrowserCapturePayload(
            fullImageBase64: fullData.base64EncodedString(),
            thumbnailBase64: thumbnailData.base64EncodedString(),
            ocrText: ocrText,
            width: fullImage.width,
            height: fullImage.height,
            visualHash: averageHash(fullImage)
        )
    }

    static func titleMatches(historyTitle: String, windowTitle: String) -> Bool {
        let history = normalizeTitle(historyTitle)
        let window = normalizeTitle(windowTitle)
        guard !history.isEmpty, !window.isEmpty else { return false }
        let prefix = String(history.prefix(32))
        return history.contains(window) || window.contains(history) || window.contains(prefix)
    }

    static func isPrivateWindowTitle(_ title: String) -> Bool {
        let value = title.lowercased()
        return value.contains("incognito") || value.contains("private browsing") || value.contains("private window")
    }

    static func frontmostWindowId(
        processIdentifier: pid_t,
        windowInfo: [[String: Any]]? = nil
    ) -> CGWindowID? {
        let windows = windowInfo ?? (CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] ?? [])
        for info in windows {
            guard (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == processIdentifier,
                  (info[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  let number = info[kCGWindowNumber as String] as? NSNumber else { continue }
            return CGWindowID(number.uint32Value)
        }
        return nil
    }

    private static func normalizeTitle(_ value: String) -> String {
        value.lowercased()
            .replacingOccurrences(of: " - google chrome", with: "")
            .replacingOccurrences(of: " — safari", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func cropBrowserChrome(_ image: CGImage) -> CGImage? {
        let crop = min(120, image.height / 8)
        guard image.height > crop + 100 else { return image }
        return image.cropping(to: CGRect(x: 0, y: 0, width: image.width, height: image.height - crop))
    }

    private func resize(_ image: CGImage, maximumWidth: Int) -> CGImage? {
        let scale = min(1, CGFloat(maximumWidth) / CGFloat(image.width))
        let width = max(1, Int(CGFloat(image.width) * scale))
        let height = max(1, Int(CGFloat(image.height) * scale))
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return context.makeImage()
    }

    private func encodeJPEG(_ image: CGImage, quality: Double) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }

    private func recognizeText(in image: CGImage) -> String {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .fast
        request.usesLanguageCorrection = false
        let handler = VNImageRequestHandler(cgImage: image)
        do {
            try handler.perform([request])
            return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        } catch {
            return ""
        }
    }

    private func averageHash(_ image: CGImage) -> String {
        var pixels = [UInt8](repeating: 0, count: 64)
        guard let context = CGContext(data: &pixels, width: 8, height: 8, bitsPerComponent: 8,
                                      bytesPerRow: 8, space: CGColorSpaceCreateDeviceGray(),
                                      bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return "0000000000000000" }
        context.interpolationQuality = .low
        context.draw(image, in: CGRect(x: 0, y: 0, width: 8, height: 8))
        let average = pixels.reduce(0) { $0 + Int($1) } / pixels.count
        var hash: UInt64 = 0
        for pixel in pixels { hash = (hash << 1) | (Int(pixel) >= average ? 1 : 0) }
        return String(format: "%016llx", hash)
    }
}
