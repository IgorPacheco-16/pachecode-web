import { CaptureRegistry } from "./protocol.js";

const elements = {
  video: document.querySelector("#camera"),
  canvas: document.querySelector("#captureCanvas"),
  placeholder: document.querySelector("#cameraPlaceholder"),
  start: document.querySelector("#startButton"),
  stop: document.querySelector("#stopButton"),
  restart: document.querySelector("#restartButton"),
  status: document.querySelector("#status"),
  transfer: document.querySelector("#transferSelect"),
  progress: document.querySelector("#progressBar"),
  percent: document.querySelector("#percentLabel"),
  received: document.querySelector("#receivedCount"),
  remaining: document.querySelector("#remainingCount"),
  duplicates: document.querySelector("#duplicateCount"),
  result: document.querySelector("#resultCard"),
  details: document.querySelector("#resultDetails"),
  download: document.querySelector("#downloadButton"),
  share: document.querySelector("#shareButton"),
};

let registry = new CaptureRegistry();
let stream = null;
let animationFrame = null;
let processing = false;
let activeTransferId = null;
const completed = new Map();
const objectUrls = new Set();

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function updateTransferPicker(transferId, filename) {
  if (!elements.transfer.querySelector(`option[value="${transferId}"]`)) {
    if (elements.transfer.disabled) elements.transfer.replaceChildren();
    const option = document.createElement("option");
    option.value = transferId;
    option.textContent = `${filename} · ${transferId.slice(0, 8)}`;
    elements.transfer.append(option);
    elements.transfer.disabled = false;
  }
  activeTransferId = transferId;
  elements.transfer.value = transferId;
}

function renderProgress(session) {
  const percent = session.percent;
  elements.progress.style.width = `${percent}%`;
  elements.percent.textContent = `${percent}%`;
  elements.received.textContent = String(session.received);
  elements.remaining.textContent = String(session.remaining);
  elements.duplicates.textContent = String(session.duplicates);
}

async function prepareDownload(transferId, session) {
  if (completed.has(transferId)) return;
  if (!globalThis.pako?.inflate) throw new Error("Dependência pako não foi carregada.");
  const result = await session.assemble(globalThis.pako.inflate);
  const mime = result.filename.toLowerCase().endsWith(".zip") ? "application/zip" : "application/octet-stream";
  const blob = new Blob([result.data], { type: mime });
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  const value = { ...result, blob, url };
  completed.set(transferId, value);
  elements.download.href = url;
  elements.download.download = result.filename;
  elements.details.textContent = `${result.filename} · ${result.data.length.toLocaleString("pt-BR")} bytes · SHA-256 ${result.sha256}`;
  elements.result.hidden = false;
  setStatus("Transferência completa e SHA-256 confirmado. O arquivo está pronto.");
  stopCamera();
}

async function processPayload(payload) {
  const { block, session, status } = await registry.ingest(payload);
  updateTransferPicker(block.transferId, block.filename);
  renderProgress(session);
  setStatus(status === "duplicate" ? "Bloco repetido ignorado." : `Bloco ${block.part} de ${block.totalParts} recebido.`);
  if (status === "added" && navigator.vibrate) navigator.vibrate(25);
  if (session.complete) await prepareDownload(block.transferId, session);
}

async function scanFrame() {
  if (!stream) return;
  if (!processing && elements.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    processing = true;
    try {
      const maxWidth = 960;
      const scale = Math.min(1, maxWidth / elements.video.videoWidth);
      elements.canvas.width = Math.max(1, Math.round(elements.video.videoWidth * scale));
      elements.canvas.height = Math.max(1, Math.round(elements.video.videoHeight * scale));
      const context = elements.canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(elements.video, 0, 0, elements.canvas.width, elements.canvas.height);
      const pixels = context.getImageData(0, 0, elements.canvas.width, elements.canvas.height);
      const code = globalThis.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "dontInvert" });
      if (code?.data) await processPayload(code.data);
    } catch (error) {
      setStatus(error.message || "Falha ao processar o QR Code.", true);
    } finally {
      processing = false;
    }
  }
  animationFrame = requestAnimationFrame(scanFrame);
}

async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setStatus("A câmera exige uma origem HTTPS confiável (ou localhost no próprio aparelho).", true);
    return;
  }
  if (!globalThis.jsQR || !globalThis.pako) {
    setStatus("Dependências locais do receptor não foram carregadas.", true);
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    elements.video.srcObject = stream;
    await elements.video.play();
    elements.placeholder.hidden = true;
    elements.start.disabled = true;
    elements.stop.disabled = false;
    setStatus("Câmera ativa. Mantenha o QR Code dentro da moldura.");
    animationFrame = requestAnimationFrame(scanFrame);
  } catch (error) {
    setStatus(`Não foi possível iniciar a câmera: ${error.message}`, true);
  }
}

function stopCamera() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  elements.video.srcObject = null;
  elements.placeholder.hidden = false;
  elements.start.disabled = false;
  elements.stop.disabled = true;
}

function restartCapture() {
  stopCamera();
  registry.clear();
  registry = new CaptureRegistry();
  completed.clear();
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
  activeTransferId = null;
  elements.transfer.replaceChildren(new Option("Nenhuma transferência detectada"));
  elements.transfer.disabled = true;
  elements.progress.style.width = "0%";
  elements.percent.textContent = "0%";
  elements.received.textContent = "0";
  elements.remaining.textContent = "—";
  elements.duplicates.textContent = "0";
  elements.result.hidden = true;
  setStatus("Captura reiniciada. Toque em “Iniciar câmera” para começar.");
}

async function shareResult() {
  const result = completed.get(activeTransferId);
  if (!result) return;
  const file = new File([result.blob], result.filename, { type: result.blob.type });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try { await navigator.share({ files: [file], title: result.filename }); } catch (error) {
      if (error.name !== "AbortError") setStatus(`Não foi possível compartilhar: ${error.message}`, true);
    }
  } else {
    setStatus("Compartilhamento de arquivos indisponível. Use “Salvar arquivo”.", true);
  }
}

elements.start.addEventListener("click", startCamera);
elements.stop.addEventListener("click", () => { stopCamera(); setStatus("Captura interrompida. Os blocos recebidos foram mantidos."); });
elements.restart.addEventListener("click", restartCapture);
elements.share.addEventListener("click", shareResult);
elements.transfer.addEventListener("change", () => {
  activeTransferId = elements.transfer.value;
  const session = registry.sessions.get(activeTransferId);
  if (session) renderProgress(session);
  const result = completed.get(activeTransferId);
  elements.result.hidden = !result;
  if (result) {
    elements.download.href = result.url;
    elements.download.download = result.filename;
  }
});

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    setStatus(`Aplicativo aberto, mas o cache offline falhou: ${error.message}`, true);
  });
}
