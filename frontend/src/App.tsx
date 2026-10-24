import { useEffect, useState } from "react";
import { fetchHealth } from "./api";

export default function App() {
  const [status, setStatus] = useState("서버 확인 중");

  useEffect(() => {
    fetchHealth()
      .then((health) => setStatus(`서버 연결됨 (모델: ${health.model})`))
      .catch(() => setStatus("서버에 연결할 수 없습니다"));
  }, []);

  return (
    <main>
      <h1>Randomy</h1>
      <p>회의록·메모를 정리하고 할 일과 결정 사항을 찾아 주는 개인 업무 보조</p>
      <p role="status">{status}</p>
    </main>
  );
}
