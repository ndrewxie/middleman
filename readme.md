# Middleman

Project description: ???

NOTE: This doesn't work on *all* sites yet for a multitude of reasons - largely because all parsers in the rewriter are hand-written, which limits the complexity of the cases that can be covered. 

Hand-writing parsers was just for fun and practice - using an off-the-shelf HTML/CSS/JS parser library would've resulted in a higher quality product. This loss of quality is acceptable for a few reasons - 1. the main goal is to unblock static sites (github, stackoverflow, etc), so missing a bunch of corner cases is mostly fine, and 2. restricting the capabilities also makes it more difficult to abuse Middleman to access inappropriate sites, allowing it to be distributed more widely to people who need it.

There is a current effort to create a new parser generator - essentially an extension of Ville Laurikari's regex master's thesis, with additional features added/planned (full parse tree extraction, regex recursion, lookahead/lookbehind). This was created to both explore the theory of automata, and because the regex engines that browsers ship with are too limited for the task - for example, Javascript doesn't support regex recursion, so arbitrarily-nested parenthesis/brackets can't be matched. Also, features like lookbehind aren't universally available (*cough safari*)

A copy of this parser project can be found [here](https://replit.com/@ndrewxie/dfaparse#src)

There is also an unstable dev version Middleman that can be found [here](https://replit.com/@ndrewxie/passthrough/) 
