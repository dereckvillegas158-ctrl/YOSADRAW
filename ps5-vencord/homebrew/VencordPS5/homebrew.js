// Vencord PS5 - entrada para el lanzador de homebrew de websrv
// (http://127.0.0.1:8080). Copia esta carpeta a /data/homebrew/VencordPS5/
// junto con eboot.elf (vencord-ps5.elf renombrado).
//
// El payload se lanza como daemon: sigue corriendo en segundo plano
// y abre el navegador del sistema en http://127.0.0.1:8095/app.

async function main() {
    const elf = window.workingDir + "/eboot.elf";
    const launch = (args) => ({ path: elf, args: args, cwd: window.workingDir, daemon: true });

    return {
        mainText: "Vencord PS5",
        secondaryText: "Discord + Vencord",
        onclick: async () => launch(""),
        options: [
            {
                text: "Abrir sin verificar TLS (si falla la conexion)",
                onclick: async () => launch("--insecure")
            },
            {
                text: "Solo iniciar el servidor (sin abrir navegador)",
                onclick: async () => launch("--no-browser")
            }
        ]
    };
}
