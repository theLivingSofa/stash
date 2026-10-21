import dns from "node:dns";
import net from "node:net";

/**
 * Prefer IPv4 and give the IPv4 fallback enough time. Some networks advertise
 * IPv6 without routing it, and Node's default 250ms happy-eyeballs window then
 * fails connections to dual-stack hosts with ETIMEDOUT.
 */
export function configureNetwork() {
  try {
    dns.setDefaultResultOrder("ipv4first");
    net.setDefaultAutoSelectFamilyAttemptTimeout(2_000);
  } catch {
    /* older runtimes: nothing to do */
  }
}
