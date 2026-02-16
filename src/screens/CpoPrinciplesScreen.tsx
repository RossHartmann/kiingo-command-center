import { useState } from "react";
import { useAppActions } from "../state/appState";

interface Principle {
  number: number;
  title: string;
  description: string;
  redFlag: string;
  spotlight: string;
}

const PRINCIPLES: { group: string; items: Principle[] }[] = [
  {
    group: "The Product \u2014 Strategic Vision",
    items: [
      {
        number: 1,
        title: "Fall in love with the problem, not the solution",
        description:
          "Solutions are temporary; problems are durable. The CPO who falls in love with a feature will defend it past its usefulness. The CPO who falls in love with the problem will find better solutions as the market evolves. Your loyalty is to the customer's pain, not to your product's current form.",
        redFlag:
          "Your roadmap describes features to build rather than problems to solve.",
        spotlight:
          "Open your current roadmap. For each item, ask: is this described as a thing to build or a problem to solve? If it reads like a feature spec ('add dark mode,' 'build dashboard'), rewrite each item as a problem statement ('users can't work comfortably in low-light environments,' 'managers lack visibility into team performance'). The problem framing opens the solution space and prevents you from shipping the wrong solution to the right problem."
      },
      {
        number: 2,
        title: "Say no more than you say yes",
        description:
          "Every feature you add is a feature you maintain forever. The product that tries to do everything does nothing well. Your most important job is deciding what not to build \u2014 and being able to explain why with conviction and data.",
        redFlag:
          "Your product does twenty things adequately instead of five things exceptionally.",
        spotlight:
          "Count the features you've shipped in the last six months. Now count how many are actively used by more than 20% of your user base. The gap between those numbers is your feature bloat tax \u2014 every unused feature still consumes maintenance, testing, and cognitive load. For your next planning cycle, practice this: for every feature you add, identify one you'll sunset. The constraint forces prioritization in a way that saying 'we'll do it all' never does."
      },
      {
        number: 3,
        title: "Ship to learn, not to launch",
        description:
          "The goal of shipping isn't the press release \u2014 it's the data. Every release should have a hypothesis, a measurement plan, and a decision framework. If you ship something and don't learn from it, you've generated activity without generating insight.",
        redFlag:
          "You can list what you shipped last quarter but not what you learned from it.",
        spotlight:
          "For your last three major releases, answer these: what was the hypothesis? What did you measure? What did the data show? What did you do differently as a result? If any of those answers is 'we didn't track that,' your shipping process is optimized for output, not learning. Add a lightweight 'learn' section to every release plan: hypothesis, metric, success criteria, and a 30-day review date."
      },
      {
        number: 4,
        title: "Simplify until it hurts, then simplify more",
        description:
          "Complexity is the natural enemy of great products. Every screen, every option, every setting is friction. Your users don't want power \u2014 they want progress. Relentlessly simplify the path from intention to outcome, even when it means cutting features that took months to build.",
        redFlag:
          "New users need a tutorial or onboarding guide to accomplish basic tasks.",
        spotlight:
          "Watch five users interact with your product for the first time \u2014 screen recordings, not analytics. Count the moments of hesitation, confusion, or wrong turns. Each one is a simplification opportunity. The test isn't whether your product can do something \u2014 it's whether a user can figure out how to do it in under ten seconds without help. If they can't, the interface is failing them."
      },
      {
        number: 5,
        title: "Own the narrative of why, not just the roadmap of what",
        description:
          "The roadmap tells people what you're building. The product vision tells them why it matters. Without a clear, compelling 'why,' the roadmap is a to-do list. With it, the roadmap is a strategy. Your team, your stakeholders, and your customers should all be able to articulate why the product exists.",
        redFlag:
          "Different team members give different answers when asked 'what is this product for?'",
        spotlight:
          "Ask five people on your team \u2014 engineers, designers, marketers \u2014 to describe the product's purpose in one sentence. If you get five different answers, your vision isn't clear enough. Write a single sentence that captures why the product exists, who it's for, and what change it creates in their life. Share it everywhere. Repeat it until people can recite it back to you. Alignment on 'why' solves 80% of prioritization arguments."
      },
      {
        number: 6,
        title: "Treat data as a product, not a byproduct",
        description:
          "Every user interaction generates data. That data can improve the product, inform the business, and create competitive advantages \u2014 but only if you design for it. Instrument intentionally, build data pipelines as carefully as features, and make product analytics a first-class capability.",
        redFlag:
          "Your product decisions are based on intuition because the data is too messy or incomplete to use.",
        spotlight:
          "For the next product decision you need to make, what data would make the answer obvious? Now check: do you have that data? Is it reliable? Can you access it in under five minutes? If any answer is no, your analytics infrastructure has a gap. Fix the gap before you make the decision. Shipping a feature without the instrumentation to evaluate it is like running an experiment without recording the results."
      }
    ]
  },
  {
    group: "The Craft \u2014 Execution Excellence",
    items: [
      {
        number: 7,
        title: "Design for the user's workflow, not your org chart",
        description:
          "Users don't care that 'search' belongs to one team and 'filters' belongs to another. They experience the product as a continuous flow. When the product is fragmented by team boundaries, the user feels it. Organize the experience around user journeys, not engineering ownership.",
        redFlag:
          "Features that should feel seamless require users to navigate between unconnected parts of the product.",
        spotlight:
          "Map your three most important user workflows end to end. At each step, note which team owns it. Where ownership changes, look for friction \u2014 inconsistent design, different interaction patterns, broken context. Those seams are where your org chart is leaking into the user experience. You don't need to reorganize the company \u2014 you need cross-team ownership of the workflow, not just the features."
      },
      {
        number: 8,
        title: "Prototype before you commit",
        description:
          "The cost of a prototype is hours. The cost of building the wrong thing is months. Before committing engineering resources to a major feature, validate the concept with prototypes, mockups, or lightweight experiments. The earlier you discover you're wrong, the cheaper it is.",
        redFlag:
          "Your team regularly builds features that get redesigned or deprecated within six months.",
        spotlight:
          "How many features shipped in the last year were substantially redesigned or removed? Each one represents a validation gap \u2014 something that should have been tested before building. For your next major feature, invest one week in a prototype before writing production code. Test it with five users. The insights from that week will save months of engineering time and produce a better product."
      },
      {
        number: 9,
        title: "Close the feedback loop in days, not months",
        description:
          "The longer the gap between shipping and learning, the more you're flying blind. Build systems that surface user feedback \u2014 quantitative and qualitative \u2014 within days of a release. Weekly user conversations, session recordings, and real-time analytics aren't optional; they're the operating system of product management.",
        redFlag:
          "You learn about user problems from support tickets three months after shipping.",
        spotlight:
          "After your last release, how quickly did you know whether it was working? If the answer is 'we checked the numbers a few weeks later,' your feedback loop is too slow. Set up a release monitoring habit: day-one analytics check, day-three user session review, week-one qualitative interviews with three users. The faster you learn, the faster you improve. Speed of learning is the only sustainable competitive advantage."
      },
      {
        number: 10,
        title: "Obsess over the defaults",
        description:
          "Most users never change the defaults. The default settings, the default view, the default workflow \u2014 these aren't fallbacks, they're the product for 80% of users. Invest disproportionate design effort in getting the defaults right, because that's the experience most people will actually have.",
        redFlag:
          "Your product requires configuration to be useful, and most users never configure it.",
        spotlight:
          "Walk through your product as a brand-new user who changes nothing. No settings adjusted, no preferences set, no customization. Is the experience good? Is it even usable? If the default experience is mediocre and you're relying on users to configure their way to value, you've inverted the work. The defaults should deliver 80% of the value. Configuration should unlock the remaining 20% for power users."
      },
      {
        number: 11,
        title: "Quality is a habit, not a phase",
        description:
          "Quality isn't something you add at the end with QA. It's a mindset that pervades every decision \u2014 from the spec to the design to the code to the release. When quality is a phase, it gets cut when timelines are tight. When quality is a habit, the team doesn't know how to ship without it.",
        redFlag:
          "Quality conversations only happen when something breaks, not when something is being built.",
        spotlight:
          "In your last three sprint retrospectives, was quality discussed proactively (how do we build better?) or only reactively (why did this break)? If quality only surfaces when something fails, it's not embedded in the culture. Add a quality criterion to your definition of done that goes beyond 'it works' \u2014 include performance, accessibility, edge cases, and user experience polish. The bar you set for done defines the product you ship."
      }
    ]
  },
  {
    group: "The CPO \u2014 Self-Management",
    items: [
      {
        number: 12,
        title: "Be the customer's advocate, especially when it's inconvenient",
        description:
          "In every prioritization meeting, someone represents revenue, someone represents engineering capacity, and someone represents the timeline. You represent the user. When the conversation drifts toward what's easy or what closes deals, it's your job to ask: 'But is this what the user actually needs?'",
        redFlag:
          "Your roadmap is driven more by sales requests than by user research.",
        spotlight:
          "Review your current roadmap priorities. For each item, trace its origin: did it come from user research, sales feedback, executive request, or competitive reaction? If more than half came from internal sources rather than direct user evidence, your product is being built for stakeholders, not users. That's not always wrong, but it should be conscious, not accidental."
      },
      {
        number: 13,
        title: "Spend time with users every week, not every quarter",
        description:
          "User empathy decays fast. If your last direct user conversation was weeks ago, you're making decisions based on stale understanding. Build a weekly habit of talking to users, watching sessions, or reviewing support conversations. There is no substitute for direct exposure.",
        redFlag:
          "Your last direct user conversation was more than two weeks ago.",
        spotlight:
          "Block one hour every week for direct user exposure. Not a report about users \u2014 actual contact. Watch three session recordings, join a support call, or do a 15-minute user interview. The insights that change your roadmap almost never come from dashboards. They come from watching a user struggle with something you thought was obvious. Protect this hour like it's your most important meeting, because it is."
      },
      {
        number: 14,
        title: "Make trade-offs transparent, not hidden",
        description:
          "Every product decision involves trade-offs. When you choose speed over polish, breadth over depth, or one segment over another, say so explicitly. Hidden trade-offs breed distrust when they surface later. Transparent trade-offs build credibility and alignment.",
        redFlag:
          "Stakeholders are surprised by the implications of a product decision because the trade-offs weren't communicated.",
        spotlight:
          "For your most recent major decision, can you articulate the trade-off in one sentence? 'We chose X, which means we're accepting Y, because Z.' If you can't, the trade-off was made implicitly, which means the people affected by it didn't get to weigh in. For every significant product decision, document the trade-off and share it proactively. The transparency might generate disagreement \u2014 but disagreement upfront is cheaper than surprises later."
      },
      {
        number: 15,
        title: "Kill your darlings",
        description:
          "The feature you conceived, championed, and shipped isn't sacred. If the data shows it's not working, sunset it. The CPO who can't kill their own ideas is a CPO who can't learn. Attachment to past decisions is the biggest obstacle to better future decisions.",
        redFlag:
          "A feature you personally championed is underperforming and you're making excuses instead of making decisions.",
        spotlight:
          "Identify one feature you personally advocated for that hasn't delivered the expected results. What's your instinct \u2014 to give it more time, or to cut it? If your instinct is always to give it more time, you're optimizing for sunk cost, not for outcomes. Set a clear deadline: if this metric doesn't hit this threshold by this date, we sunset it. Then hold yourself to it. Your team is watching how you handle your own failures."
      },
      {
        number: 16,
        title: "Build product sense across the organization",
        description:
          "Product thinking shouldn't be confined to the product team. When engineers understand user problems, they build better solutions. When sales understands the roadmap logic, they sell more honestly. When support understands the design intent, they troubleshoot more effectively. Spread product context broadly.",
        redFlag:
          "Non-product teams describe the product in terms of features rather than user value.",
        spotlight:
          "Ask an engineer, a salesperson, and a support agent to describe why your most recent feature matters. If any of them describes what it does without explaining why it matters to the user, there's a context gap. Start a lightweight monthly 'product context' share: what we shipped, who it's for, what problem it solves, and what we're learning. Five minutes of context prevents months of misalignment."
      },
      {
        number: 17,
        title: "Balance the horizon \u2014 ship today, plan for tomorrow, imagine the future",
        description:
          "The CPO who only ships incrementally never transforms the product. The CPO who only envisions the future never delivers value. Hold three time horizons simultaneously: what we're shipping this quarter, what we're planning for next quarter, and what the product could become in two years. All three need active attention.",
        redFlag:
          "Your roadmap only extends one quarter, or it only describes a distant vision with no near-term plan.",
        spotlight:
          "Can you articulate your product strategy at all three horizons? This quarter: what are we shipping and why? Next quarter: what are we preparing and what do we need to learn? Two years: what transformation are we building toward? If any horizon is blank, you're unbalanced. Most CPOs are strong on one horizon and weak on the others. Identify your weak horizon and dedicate focused thinking time to it this week."
      }
    ]
  }
];

const ALL_PRINCIPLES = PRINCIPLES.flatMap((g) => g.items);

export function CpoPrinciplesScreen(): JSX.Element {
  const actions = useAppActions();
  const [spotlightIndex, setSpotlightIndex] = useState(() =>
    Math.floor(Math.random() * ALL_PRINCIPLES.length)
  );
  const spotlight = ALL_PRINCIPLES[spotlightIndex];
  const [discussInput, setDiscussInput] = useState("");

  function handleDiscussSubmit(): void {
    const text = discussInput.trim();
    if (!text) return;

    const context = [
      `I'm reflecting on CPO Principle #${spotlight.number}: "${spotlight.title}"`,
      "",
      `> ${spotlight.description}`,
      "",
      `> Red flag: ${spotlight.redFlag}`,
      "",
      `> ${spotlight.spotlight}`,
      "",
      `---`,
      "",
      text
    ].join("\n");

    actions.setPendingChatContext({ systemPrompt: "", initialMessage: context });
    actions.selectScreen("chat");
    setDiscussInput("");
  }

  return (
    <section className="screen ceo-principles-screen">
      <div className="screen-header">
        <h2>CPO Operating Principles</h2>
        <p>
          Seventeen principles for product leadership &mdash; solving the right problems,
          shipping with purpose, and building products users love.
        </p>
      </div>

      <div className="spotlight-card">
        <div className="spotlight-label">Today's focus</div>
        <div className="spotlight-number">{spotlight.number}</div>
        <h3 className="spotlight-title">{spotlight.title}</h3>
        <p className="spotlight-description">{spotlight.description}</p>
        <div className="spotlight-narrative">{spotlight.spotlight}</div>
        <p className="spotlight-redflag">Red flag: {spotlight.redFlag}</p>

        <div className="spotlight-discuss">
          <input
            className="spotlight-discuss-input"
            type="text"
            placeholder="What's on your mind about this principle?"
            value={discussInput}
            onChange={(e) => setDiscussInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.repeat) {
                e.preventDefault();
                handleDiscussSubmit();
              }
            }}
          />
        </div>
      </div>

      {PRINCIPLES.map((group) => (
        <div className="card" key={group.group}>
          <h3>{group.group}</h3>
          {group.items.map((p) => (
            <div
              className={`principle-item${p.number === spotlight.number ? " principle-active" : ""}`}
              key={p.number}
              onClick={() => setSpotlightIndex(ALL_PRINCIPLES.indexOf(p))}
            >
              <span className="principle-number">{p.number}</span>
              <div>
                <strong>{p.title}</strong>
                <p>{p.description}</p>
                <p className="red-flag">Red flag: {p.redFlag}</p>
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
