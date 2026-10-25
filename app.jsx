// import { ipcMain } from "electron";
import { useRef , useState } from "react";

function App() {
  const videoRef = useRef(null);
  const[data, setData] = useState("")

  async function getCamera() {
    const videoData = await navigator.mediaDevices.getUserMedia({
      video: true,
    });
    videoRef.current.srcObject = videoData;
  }

  async function getFullscreen(){
    window.electronAPI.setFullScreen()
  }

  function handleSave(){
    window.electronAPI.save(data)
  }
  function handleUpdate(){
    window.electronAPI.update(data)
  }
  function handleDelete(){
    window.electronAPI.delete(data)
  }
  function handleCreate(){
    window.electronAPI.create()
  }
  async function handleGetData(){
    const value = await window.electronAPI.getData(data)
    setData(value)
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
        <input
            type="text"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Enter data"
        />
          <div className="text-sm text-slate-500">{`Time Left: Minutes Seconds`}</div>
          <button onClick={handleSave} className="px-6 py-3 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
            Save
          </button>
          <button onClick={handleUpdate} className="px-6 py-3 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
            update
          </button>
          <button onClick={handleDelete} className="px-6 py-3 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
            delete
          </button>
          <button onClick={handleCreate} className="px-6 py-3 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
            create
          </button>
          <button onClick={handleGetData} className="px-6 py-3 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
            get
          </button>
          {data}
        </div>
      </div>
    </div>
  );
}

export default App;