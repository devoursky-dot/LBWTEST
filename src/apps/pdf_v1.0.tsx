/*
 # 기존 패키지 삭제
 npm uninstall pdfjs-dist

 # 저사양 기기용 안정 버전 설치
 npm install pdfjs-dist@2.16.105

 버전을 반드시 맞추고 실행해야한다는 것을 항상 체크해주세요
*/


import React, { useRef } from "react"
import * as pdfjsLib from "pdfjs-dist"

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

export default function App() {

  const containerRef = useRef<HTMLDivElement | null>(null)

  async function loadPDF(file: File) {

    if (!containerRef.current) return

    containerRef.current.innerHTML = ""

    const buffer = await file.arrayBuffer()

    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {

      const page = await pdf.getPage(pageNum)

      const viewport = page.getViewport({ scale: 1.5 })

      const canvas = document.createElement("canvas")
      const context = canvas.getContext("2d")

      if (!context) continue

      canvas.width = viewport.width
      canvas.height = viewport.height

      canvas.style.marginBottom = "20px"
      canvas.style.boxShadow = "0 0 5px rgba(0,0,0,0.2)"

      containerRef.current.appendChild(canvas)

      await page.render({
        canvasContext: context,
        viewport
      }).promise

    }

  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {

    const file = e.target.files?.[0]

    if (!file) return

    loadPDF(file)

  }

  return (

    <div style={{
      width:"100vw",
      height:"100vh",
      display:"flex",
      flexDirection:"column"
    }}>

      <div style={{
        height:60,
        background:"#222",
        display:"flex",
        alignItems:"center",
        padding:"10px",
        color:"white"
      }}>

        <input
          type="file"
          accept="application/pdf"
          onChange={onFile}
        />

      </div>

      <div
        ref={containerRef}
        style={{
          flex:1,
          overflow:"auto",
          background:"#ddd",
          display:"flex",
          flexDirection:"column",
          alignItems:"center",
          padding:"20px"
        }}
      />

    </div>

  )

}