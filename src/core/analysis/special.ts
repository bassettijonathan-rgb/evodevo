/**
 * Special functions for analytic checks (not used inside the simulation, so the
 * standard Math library is fine here).
 */

/** Modified Bessel function I₀(x), Abramowitz & Stegun 9.8.1 (|x| ≤ 3.75, |ε| < 1.6e-7). */
function besselI0Small(x: number): number {
  const t = (x / 3.75) ** 2;
  return 1 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492 + t * (0.2659732 + t * (0.0360768 + t * 0.0045813)))));
}

/**
 * Modified Bessel function of the second kind K₀(x), x > 0.
 * Abramowitz & Stegun 9.8.5 (x ≤ 2) and 9.8.6 (x ≥ 2); relative error < 2e-7.
 *
 * K₀ is the 2D steady state of diffusion with decay from a point source:
 *   D∇²c − kc + Sδ(r) = 0  ⇒  c(r) = S/(2πD) · K₀(r/L),  L = √(D/k).
 */
export function besselK0(x: number): number {
  if (x <= 0) return Infinity;
  if (x <= 2) {
    const t = (x / 2) ** 2;
    return (
      -Math.log(x / 2) * besselI0Small(x) +
      (-0.57721566 + t * (0.4227842 + t * (0.23069756 + t * (0.0348859 + t * (0.00262698 + t * (0.0001075 + t * 0.0000074))))))
    );
  }
  const t = 2 / x;
  return (
    (Math.exp(-x) / Math.sqrt(x)) *
    (1.25331414 + t * (-0.07832358 + t * (0.02189568 + t * (-0.01062446 + t * (0.00587872 + t * (-0.0025154 + t * 0.00053208))))))
  );
}
