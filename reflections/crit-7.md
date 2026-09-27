# Crit 7 reflection

The breakthrough was stopping treating the COMP3320 report as an isolated bug.
The interface claimed that COMP2100 was incompatible with COMP3320 even though
the official wording names COMP2100 as a prerequisite. Instead of adding a
special case, I went back to the source pages and compared all 98 course-rule
blocks with the planner's interpretation. That exposed a flaw in the model: it
flattened a whole requisite block into course codes, then let the word
“incompatible” contaminate earlier prerequisite clauses. Re-extracting the page
structure and modelling prerequisites, co-requisites, incompatibilities,
permissions and unresolved wording separately found nine false
incompatibilities and fourteen missed exclusions. The important advance was not
the parser itself, but changing the question from “How do I make this example
pass?” to “What evidence would show that this entire class of interpretation is
sound?”

This work changed the kind of software developer I want to be. I want to build
systems that are explicit about what they know, what they infer and what they
cannot safely decide. In a degree planner, a confident but incorrect rule can
mislead a student, so preserving official wording and surfacing ambiguity is
better than pretending every sentence can be automated. I also learned to
separate historical facts from planning advice: completed study should be
recorded, while future choices can receive non-blocking warnings. I want that
combination of source-grounded modelling, systematic correction and honest
limits to become part of how I approach software beyond this project.
