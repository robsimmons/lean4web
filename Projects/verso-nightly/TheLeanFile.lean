import Mathlib.Tactic.Ring -- import the `ring` tactic

/-! let {lit}`R` be a commutative ring (for example the real numbers) -/

variable (R : Type) [CommRing R]

/-! let {lit}`x` and {lit}`y` be elements of {lean}`R` -/

variable (x y : R)

/-! then $`(x+y)×(x+2y)=x^2+3xy+2y^2` -/

example : (x+y)*(x+2*y)=x^2+3*x*y+2*y^2 := by
  -- the `ring` tactic solves this goal automatically
  ring
