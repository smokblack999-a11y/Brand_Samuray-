(() => {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || "";

  const $ = (id) => document.getElementById(id);
  const setStatus = (text) => $("status").textContent = text;

  if (tg) {
    tg.ready();
    tg.expand();
    $("authState").textContent = "Telegram OK";
  } else {
    $("authState").textContent = "Browser";
  }

  async function upload(file) {
    if (!initData) throw new Error("Откройте страницу через Telegram Mini App");
    const response = await fetch(
      "/api/webapp/media?filename=" + encodeURIComponent(file.name || "capture.bin"),
      {
        method: "POST",
        headers: {
          "X-Telegram-Init-Data": initData,
          "Content-Type": file.type || "application/octet-stream"
        },
        body: file
      }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || "Ошибка загрузки");
    return body;
  }

  async function handleFile(file) {
    if (!file) return;
    const preview = $("preview");
    preview.innerHTML = "";
    const url = URL.createObjectURL(file);
    if (file.type.startsWith("video/")) {
      const video = document.createElement("video");
      video.controls = true; video.src = url; preview.appendChild(video);
    } else if (file.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = url; preview.appendChild(img);
    }
    setStatus("Загрузка " + file.name + "…");
    try {
      const result = await upload(file);
      setStatus("Готово: " + result.media.type + ", " + result.media.bytes + " bytes");
    } catch (error) {
      setStatus(error.message);
    }
  }

  $("cameraButton").onclick = () => $("cameraInput").click();
  $("galleryButton").onclick = () => $("galleryInput").click();
  $("cameraInput").onchange = (e) => handleFile(e.target.files?.[0]);
  $("galleryInput").onchange = (e) => handleFile(e.target.files?.[0]);

  $("locationButton").onclick = () => {
    if (!navigator.geolocation) {
      setStatus("GPS недоступен на этом устройстве.");
      return;
    }
    setStatus("Запрашиваю координаты…");
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const response = await fetch("/api/webapp/location", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData },
          body: JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy ?? null,
            timestamp: position.timestamp
          })
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message || "Ошибка координат");
        setStatus("Координаты сохранены: " + body.location.latitude.toFixed(6) + ", " + body.location.longitude.toFixed(6));
      } catch (error) {
        setStatus(error.message);
      }
    }, (error) => setStatus("GPS: " + error.message), {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    });
  };
})();
