import { type CourseRef, type PickNode, type Program, course, courses } from "../lib/requirements";
import { majors, specialisations } from "./pathways";

// The four programs, transcribed from research/2027/program-*.txt. Group
// `text` is the official sentence; nothing here is paraphrased into a rule.

const P = "https://programsandcourses.anu.edu.au/2027/program";

const choose6 = (id: string, title: string, a: CourseRef, b: CourseRef): PickNode => ({
  kind: "pick",
  id,
  title,
  text: "6 units from completion of a course from the following list:",
  units: 6,
  bound: "exact",
  children: [a, b],
});

const ictCourses = (): CourseRef[] => [
  course("ARTH2181"),
  course("ASIA3032", { listedAs: "Digital Asia: Technology and Society" }),
  ...courses("DESN2010", "ENGN1211", "ENVS2015", "INFS2024", "INFS3002", "INFS3024"),
  ...courses("MATH1013", "MATH1115", "MATH2301", "MATH2307", "MGMT2009"),
  course("MUSI3309", { listedAs: "Music and Digital Media" }),
  ...courses("SCOM3029", "SOCY2038", "SOCY2166", "STAT1003", "STAT1008"),
];

const TPS_NOTE =
  "The planner counts a course towards this when its official course page lists the Transdisciplinary graduate attribute. Confirm the tag with the School.";

const honours = (code: string, name: string): Program["untracked"][number] => ({
  title: "Honours calculation",
  text: [
    `${code} ${name} will be used to record the Class of Honours and the Mark. See the program page for the full calculation.`,
  ],
});

export const programs: Program[] = [
  {
    code: "BCOMP",
    name: "Bachelor of Computing",
    year: 2027,
    units: 144,
    duration: "3 year full-time",
    url: `${P}/BCOMP`,
    summary:
      "BCOMP is made up of compulsory requirements (seven courses) and an additional suite of computing requirements (nine courses) plus electives.",
    constraints: [
      {
        id: "total",
        kind: "total",
        units: 144,
        text: "The Bachelor of Computing requires completion of 144 units",
      },
      {
        id: "tps",
        kind: "min",
        units: 12,
        filter: { transdisciplinary: true },
        text: "A minimum of 12 units must come from completion of courses tagged as Transdisciplinary Problem-Solving",
      },
      {
        id: "comp34",
        kind: "min",
        units: 24,
        filter: { subjects: ["COMP"], levels: [3, 4] },
        text: "A minimum of 24 units must come from completion of 3000 and 4000-level COMP courses",
      },
      {
        id: "level1",
        kind: "max",
        units: 60,
        filter: { levels: [1] },
        text: "A maximum of 60 units may come from completion of 1000-level courses",
      },
    ],
    untracked: [],
    requirements: [
      {
        kind: "all",
        id: "lists",
        title: "Computing requirements",
        text: "A minimum of 96 units from completion of courses from the following lists:",
        units: 96,
        children: [
          choose6("prog1", "Programming as Problem Solving", course("COMP1100"), course("COMP1130")),
          choose6("prog2", "Structured Programming", course("COMP1110"), course("COMP1140")),
          choose6("maths", "Mathematics", course("MATH1005"), course("MATH2222")),
          {
            kind: "all",
            id: "compulsory",
            title: "Compulsory courses",
            text: "24 units from the completion of the following compulsory courses:",
            units: 24,
            children: courses("COMP1600", "COMP2100", "COMP2300", "COMP2400"),
          },
          {
            kind: "one",
            id: "computing",
            title: "COMP courses or a computing major",
            text: "48 units from completion of courses from the subject area COMP Computer Science OR completion of one of the following computing majors:",
            units: 48,
            options: [
              {
                kind: "open",
                id: "comp48",
                title: "48 units of COMP courses",
                text: "48 units from completion of courses from the subject area COMP Computer Science",
                units: 48,
                filter: { subjects: ["COMP"] },
              },
              ...majors,
            ],
          },
          {
            kind: "pick",
            id: "ict",
            title: "ICT-related course",
            text: "6 units from completion of Information and Communications Technology-related courses from the following list:",
            units: 6,
            bound: "exact",
            children: ictCourses(),
          },
        ],
      },
      {
        kind: "open",
        id: "electives",
        title: "Electives",
        text: "A minimum of 48 units from completion of elective courses offered by ANU",
        units: 48,
      },
    ],
  },
  {
    code: "AACOM",
    name: "Bachelor of Advanced Computing (Honours)",
    year: 2027,
    units: 192,
    duration: "4 year full-time",
    url: `${P}/AACOM`,
    summary:
      "During your final year you will be able to bring together your skills and knowledge to complete an Internship, Group project for a client on a real-world problem or a Research Project.",
    constraints: [
      {
        id: "total",
        kind: "total",
        units: 192,
        text: "The Bachelor of Advanced Computing (Honours) requires completion of 192 units",
      },
      {
        id: "level1",
        kind: "max",
        units: 60,
        filter: { levels: [1] },
        text: "A maximum of 60 units may come from completion of 1000-level courses",
      },
      {
        id: "comp4",
        kind: "min",
        units: 48,
        filter: { subjects: ["COMP"], levels: [4] },
        text: "A minimum of 48 units that come from the completion of 4000-level courses from the subject area COMP Computer Science.",
      },
      {
        id: "tps",
        kind: "min",
        units: 12,
        filter: { transdisciplinary: true },
        text: "A minimum of 12 units of courses tagged as Transdisciplinary Problem-Solving",
      },
    ],
    untracked: [honours("COMP4801", "Final Honours Grade")],
    requirements: [
      choose6("prog1", "Programming as Problem Solving", course("COMP1100"), course("COMP1130")),
      choose6("prog2", "Structured Programming", course("COMP1110"), course("COMP1140")),
      choose6("maths", "Mathematics", course("MATH1005"), course("MATH2222")),
      {
        kind: "all",
        id: "compulsory",
        title: "Compulsory courses",
        text: "48 units from completion of compulsory courses from the following list:",
        units: 48,
        children: [
          course("COMP2100", { listedAs: "Software Design Methodologies" }),
          ...courses("COMP2120", "COMP2300", "COMP2310", "COMP2400", "COMP3600", "COMP3630", "COMP4450"),
        ],
      },
      {
        kind: "one",
        id: "specialisation",
        title: "Specialisation",
        text: "24 units from the completion of one of the following specialisations:",
        units: 24,
        options: specialisations,
      },
      {
        kind: "open",
        id: "comp34",
        title: "3000/4000-level COMP",
        text: "18 units from the completion of 3000 or 4000-level courses from the subject area COMP Computer Science",
        units: 18,
        filter: { subjects: ["COMP"], levels: [3, 4] },
      },
      {
        kind: "pick",
        id: "ict",
        title: "ICT-related courses",
        text: "12 units from completion of Information and Communications Technology-related courses from the following list:",
        units: 12,
        bound: "exact",
        children: ictCourses(),
      },
      {
        kind: "one",
        id: "final",
        title: "Research, team project or internship",
        text: "Either:",
        units: 24,
        options: [
          {
            kind: "all",
            id: "final.research",
            title: "Computing Research Project",
            text: "24 units from completion of COMP4550 Computing Research Project, which must be completed twice, in consecutive semesters (12+12 units)",
            units: 24,
            children: [course("COMP4550", { enrolments: 2 })],
          },
          {
            kind: "all",
            id: "final.team",
            title: "Software Engineering Team Project",
            text: "12 units from COMP4500 Software Engineering Team Project, which must be completed twice, in consecutive semesters (6+6 units) AND 12 units from the completion of further 4000-level courses from the subject area COMP Computer Science",
            units: 24,
            children: [
              course("COMP4500", { enrolments: 2 }),
              {
                kind: "open",
                id: "final.team.comp4",
                title: "Further 4000-level COMP",
                text: "12 units from the completion of further 4000-level courses from the subject area COMP Computer Science",
                units: 12,
                filter: { subjects: ["COMP"], levels: [4] },
              },
            ],
          },
          {
            kind: "all",
            id: "final.internship",
            title: "Advanced Computing Internship",
            text: "COMP4820 Advanced Computing Internship (12 units) AND 12 units from the completion of further 4000-level courses from the subject area COMP Computer Science",
            units: 24,
            children: [
              course("COMP4820"),
              {
                kind: "open",
                id: "final.internship.comp4",
                title: "Further 4000-level COMP",
                text: "12 units from the completion of further 4000-level courses from the subject area COMP Computer Science",
                units: 12,
                filter: { subjects: ["COMP"], levels: [4] },
              },
            ],
          },
        ],
      },
      {
        kind: "open",
        id: "electives",
        title: "Electives",
        text: "A minimum of 48 units from completion of elective courses offered by ANU",
        units: 48,
      },
    ],
  },
  {
    code: "AACRD",
    name: "Bachelor of Advanced Computing (Research and Development) (Honours)",
    year: 2027,
    units: 192,
    duration: "4 year full-time",
    url: `${P}/AACRD`,
    summary:
      "What sets the Bachelor of Advanced Computing (Research and Development) (Honours) program apart is its emphasis on research.",
    constraints: [
      {
        id: "total",
        kind: "total",
        units: 192,
        text: "The Bachelor of Advanced Computing (Research and Development) (Honours) requires completion of 192 units",
      },
      {
        id: "level1",
        kind: "max",
        units: 60,
        filter: { levels: [1] },
        text: "A maximum of 60 units may come from completion of 1000-level courses",
      },
      {
        id: "comp4",
        kind: "min",
        units: 48,
        filter: { subjects: ["COMP"], levels: [4] },
        text: "A minimum of 48 units must come from completion of 4000-level courses from the subject area COMP",
      },
      {
        id: "tps",
        kind: "min",
        units: 12,
        filter: { transdisciplinary: true },
        text: "A minimum of 12 units of courses tagged as Transdisciplinary Problem-Solving",
      },
    ],
    untracked: [
      {
        title: "Progression and graduation",
        text: [
          "After the first four periods of enrolment students must achieve a minimum 75% Weighted Average Mark in Computing courses. Students who do not achieve a minimum 75% Weighted Average Mark will be transferred to the Bachelor of Advanced Computing (Honours).",
          "To continue into the final year of the program students must have completed 144 units and achieved a minimum 80% Weighted Average Mark calculated from the courses that contribute to the final Honours grade calculation. Students who do not achieve this 80% Weighted Average Mark will be automatically transferred to the Bachelor of Advanced Computing (Honours) degree.",
          "To graduate with the Bachelor of Advanced Computing (Research and Development) (Honours) students must achieve a minimum 80% final Honours mark. Students who do not achieve a minimum 80% final Honours mark will be transferred to the Bachelor of Advanced Computing (Honours) degree program prior to graduating.",
        ],
      },
      honours("COMP4801", "Final Honours Grade"),
    ],
    requirements: [
      {
        kind: "all",
        id: "compulsory",
        title: "Compulsory courses",
        text: "78 units from completion of compulsory courses from the following list:",
        units: 78,
        children: [
          ...courses("COMP1130", "COMP1140", "COMP2100", "COMP2300", "COMP2550", "COMP3600", "COMP3630"),
          course("COMP3770", { enrolments: 2, listedAs: "Individual Research Project" }),
          course("COMP4550", { enrolments: 2 }),
        ],
      },
      {
        kind: "pick",
        id: "maths",
        title: "Mathematics and statistics",
        text: "18 units from completion of courses from the following list:",
        units: 18,
        bound: "exact",
        children: courses(
          "MATH1005",
          "MATH1013",
          "MATH1014",
          "MATH1115",
          "MATH1116",
          "MATH2222",
          "STAT1003",
          "STAT1008",
        ),
      },
      {
        kind: "open",
        id: "comp4",
        title: "4000-level COMP",
        text: "24 units from the completion of 4000-level courses from the subject area COMP Computer Science",
        units: 24,
        filter: { subjects: ["COMP"], levels: [4] },
      },
      {
        kind: "open",
        id: "tps",
        title: "Transdisciplinary Problem-Solving",
        text: "12 units of Transdisciplinary Problem-Solving tagged courses",
        units: 12,
        filter: { transdisciplinary: true },
        notes: [TPS_NOTE],
      },
      {
        kind: "open",
        id: "electives-comp",
        title: "Electives (may include COMP)",
        text: "12 units from completion of elective courses offered by ANU, which may include courses in the subject area COMP Computer Science",
        units: 12,
      },
      {
        kind: "open",
        id: "electives",
        title: "Electives",
        text: "A minimum of 48 units from completion of elective courses offered by ANU",
        units: 48,
      },
    ],
  },
  {
    code: "AENSE",
    name: "Bachelor of Engineering (Honours) in Software Engineering",
    year: 2027,
    units: 192,
    duration: "4 year full-time",
    url: `${P}/AENSE`,
    summary:
      "Software Engineering is about building effective software systems that address complex problems in a broad range of domains including transport, communications, finance, medicine, science, entertainment and the arts.",
    constraints: [
      {
        id: "total",
        kind: "total",
        units: 192,
        text: "The Bachelor of Engineering (Honours) in Software Engineering requires completion of 192 units",
      },
      {
        id: "level1",
        kind: "max",
        units: 60,
        filter: { levels: [1] },
        text: "A maximum of 60 units may come from completion of 1000-level courses",
      },
      {
        id: "tps",
        kind: "min",
        units: 12,
        filter: { transdisciplinary: true },
        text: "A minimum of 12 units of courses tagged as Transdisciplinary Problem-Solving",
      },
    ],
    untracked: [
      {
        title: "Honours",
        text: [
          "Students must formally enrol in ENGN4100 Engineering Honours at the commencement of their intended final semester.",
          "ENGN4100 Engineering Honours Grade will be used to calculate the Class of Honours and the mark. See the program page for the full weighted average mark calculation.",
        ],
      },
    ],
    requirements: [
      {
        kind: "all",
        id: "compulsory",
        title: "Compulsory courses",
        text: "108 units from completion of the following compulsory courses:",
        units: 108,
        children: [
          ...courses("COMP1600", "COMP2100", "COMP2120"),
          course("COMP2300", { listedAs: "Computer Organisation and Program Execution" }),
          ...courses("COMP2310", "COMP2400"),
          course("COMP3500", { enrolments: 2 }),
          ...courses("COMP3600", "COMP3900", "COMP4130", "ENGN1211", "ENGN2300", "ENGN2301", "ENGN3100"),
          ...courses("ENGN3300", "ENGN3301", "ENGN4213", "MATH1005"),
        ],
      },
      {
        kind: "pick",
        id: "project",
        title: "Final-year project",
        text: "12 units from completion of a course from the following list:",
        units: 12,
        bound: "exact",
        children: [
          course("ENGN4300", { enrolments: 2, units: 12, listedAs: "Capstone Project" }),
          course("ENGN4350", { enrolments: 2, units: 12 }),
          course("COMP4500", { enrolments: 2 }),
        ],
      },
      choose6("prog1", "Programming as Problem Solving", course("COMP1100"), course("COMP1130")),
      choose6("prog2", "Structured Programming", course("COMP1110"), course("COMP1140")),
      choose6("maths", "Mathematics", course("MATH1013"), course("MATH1115")),
      {
        kind: "pick",
        id: "foundations",
        title: "Information theory, mechanics or electronics",
        text: "6 units from completion of a course from the following list:",
        units: 6,
        bound: "exact",
        children: courses("COMP2610", "ENGN1217", "ENGN1218"),
      },
      {
        kind: "open",
        id: "engn-comp",
        title: "ENGN or COMP courses",
        text: "24 units from completion of courses from the following subject areas: ENGN Engineering or COMP Computer Science",
        units: 24,
        filter: { subjects: ["ENGN", "COMP"] },
      },
      {
        kind: "open",
        id: "electives",
        title: "Electives",
        text: "24 units from completion of elective courses offered by ANU.",
        units: 24,
      },
    ],
  },
];

export const programByCode = new Map(programs.map((p) => [p.code, p]));
