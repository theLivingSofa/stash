export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { configureNetwork } = await import("./lib/net");
    configureNetwork();
  }
}
