// ভয়েস মেসেজ রেকর্ডার হুক (MediaRecorder)।
import { useRef, useState } from 'react'

export function useRecorder() {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const mr = useRef<MediaRecorder | null>(null)
  const chunks = useRef<BlobPart[]>([])
  const timer = useRef<any>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const start = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
      rec.start(250)
      mr.current = rec
      setRecording(true)
      setSeconds(0)
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000)
      return true
    } catch {
      return false
    }
  }

  const stop = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const rec = mr.current
      // রেকর্ডার নেই বা আগেই থেমে গেছে — onstop আর ফায়ার হবে না,
      // প্রমিজ ঝুলে থাকত (যেমন "পাঠান"-এ ডাবল-ট্যাপ করলে)।
      if (!rec || rec.state === 'inactive') {
        mr.current = null
        streamRef.current?.getTracks().forEach((t) => t.stop())
        setRecording(false)
        clearInterval(timer.current)
        return resolve(null)
      }
      rec.onstop = () => {
        mr.current = null
        streamRef.current?.getTracks().forEach((t) => t.stop())
        setRecording(false)
        clearInterval(timer.current)
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
        resolve(blob.size ? blob : null)
      }
      rec.stop()
    })

  const cancel = () => {
    const rec = mr.current
    if (rec && rec.state !== 'inactive') {
      rec.onstop = () => {}
      rec.stop()
    }
    mr.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    setRecording(false)
    clearInterval(timer.current)
  }

  return { recording, seconds, start, stop, cancel }
}
