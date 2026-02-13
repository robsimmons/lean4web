import Mathlib
import VersoManual
open Verso Doc
open Verso.Genre Manual
open Verso.Genre.Manual.InlineLean

#doc (Manual) "My Document" =>

This is a Verso document.

It can include inline math, like this: $`x + 4 = -3`....

It can also include block math, like
$$`\int_\mathsf{this}^\mathtt{orthis} \mathit{or{\ldots}maybe{\ldots}this}`

We also support inline lean, like this: {lean}`Nat.add_assoc`.

We also support block lean, like this:

```lean
-- let R be a commutative ring (for example the reals)
variable (R : Type) [CommRing R]

-- let x and y be elements of R
variable (x y : R)

-- then (x+y)*(x+2y)=x^2+3xy+2y^2

example : (x+y)*(x+2*y)=x^2+3*x*y+2*y^2 := by
  -- the `ring` tactic solves this goal automatically
  ring
```
