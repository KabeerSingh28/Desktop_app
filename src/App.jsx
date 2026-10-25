import { useRef } from "react";

function App() {
  const videoRef = useRef(null);

  async function getCamera() {
    // Camera access is handled natively by the browser (getUserMedia).
    // No IPC needed here – the main process does not mediate camera access.
    const videoData = await navigator.mediaDevices.getUserMedia({ video: true });
    videoRef.current.srcObject = videoData;
  }

  async function getFullscreen() {
    // Route fullscreen through the IPC bridge (window.athena) so the main
    // process can enforce kiosk-level lockdown in a later phase without
    // the renderer needing to change. Fallback to the DOM API if running
    // outside Electron (e.g. Storybook / browser dev preview).
    if (window.athena) {
      await window.athena.enterFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-2xl">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-9">
          {/* Section 1: Camera */}
          <div className="flex items-start gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Configure Camera</h3>
              <p className="text-sm text-slate-500 mb-5">Kindly configure Camera to attempt quiz/contests.</p>
              <div className="flex items-center gap-4">
                <button onClick={getCamera} className="px-5 py-3 rounded-lg bg-black text-white text-sm font-semibold hover:bg-neutral-800">
                  Get Camera Access
                </button>

                {/* Video Feed Preview */}
                <video autoPlay ref={videoRef} className="w-40 h-24 rounded-md bg-black object-cover" />
              </div>
            </div>
          </div>

          <div className="h-px bg-slate-100 my-8"></div>

          {/* Section 2: Fullscreen */}
          <div className="flex items-start gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900 mb-4">Switch to full screen</h3>
              <button onClick={getFullscreen} className="px-5 py-3 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
                Give Full Screen Permissions
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Action Buttons */}
        <div className="flex items-center justify-between mt-6">
          <button className="px-6 py-3 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
            Go To Test
          </button>
          <div className="text-sm text-slate-500">{`Time Left: Minutes Seconds`}</div>
        </div>
      </div>
    </div>
  );
}

export default App;
