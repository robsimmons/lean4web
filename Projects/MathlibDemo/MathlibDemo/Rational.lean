import Mathlib.Data.Rat.Init -- import notation ℚ for rationals
import Mathlib.Tactic.Linarith -- a linear arithmetic tactic
import Mathlib.Tactic.Ring -- import the `ring` tactic

/-! let {lit}`x`, {lit}`y` and {lit}`z` be rationals (variables in {lean}`ℚ`) -/
variable (x y z : ℚ)

/-! let's prove that if {lean}`x < y` and {lean}`y + 3 < z + 10` then {lean}`x + 37 < z + 44` -/
example (h₁ : x < y) (h₂ : y + 3 < z + 10) : x + 37 < z + 44 := by
  linarith -- the `linarith` tactic can do this automatically

/-!
let's prove that $`(x + y)^2 = x^2 + 2xy + y^2`. Mathlib's
[{tactic}`ring` tactic](https://leanprover-community.github.io/mathlib4_docs/Mathlib/Tactic/Ring/Basic.html)
can do this automatically.
-/

example : (x + y) ^ 2 = x ^ 2 + 2 * x * y + y ^ 2 := by
  ring
