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
    group: "The Platform \u2014 Technical Strategy",
    items: [
      {
        number: 1,
        title: "Build for the problem you have, not the one you might get",
        description:
          "Premature scaling kills more startups than technical debt. Design for today's load with clean seams for tomorrow's. The architecture that handles 10x volume but ships six months late is worse than the one that handles 3x and ships next week.",
        redFlag:
          "The team is building infrastructure for a scale you haven't reached and can't predict.",
        spotlight:
          "Look at your current architecture decisions in flight. For each one, ask: is this solving a problem we have today, or a problem we're afraid of having someday? If it's the latter, can you defer it with a clean interface that lets you swap in the better solution later? The best technical decisions preserve optionality without paying for complexity you don't need yet."
      },
      {
        number: 2,
        title: "Technical debt is a tool, not a sin",
        description:
          "Every shortcut has an interest rate. Some debt is cheap and worth carrying \u2014 a prototype that validates a market, a hack that unblocks a launch. Other debt compounds until it paralyzes the team. Your job is to know the difference and manage the balance sheet deliberately.",
        redFlag:
          "The team treats all technical debt as equally bad, or equally acceptable.",
        spotlight:
          "Categorize your current technical debt into three buckets: deliberate and cheap (shortcuts you chose knowingly), deliberate and expensive (things you need to fix soon), and accidental (things that got messy without anyone deciding). The third bucket is the dangerous one \u2014 it means your process isn't surfacing quality decisions. Focus your paydown efforts on the expensive deliberate debt first, and fix the process that creates accidental debt."
      },
      {
        number: 3,
        title: "Availability is a feature, not an ops problem",
        description:
          "Users don't distinguish between 'the feature is broken' and 'the service is down.' Reliability is the foundation every other feature sits on. If you're shipping features faster than you're improving reliability, you're building on sand.",
        redFlag:
          "Your team ships new features while known reliability issues persist.",
        spotlight:
          "What's your current uptime? More importantly, what's the customer-perceived reliability \u2014 including slow responses, partial failures, and degraded experiences? If you don't measure perceived reliability separately from server uptime, you're missing the story your customers are living. Set an error budget: the amount of unreliability you're willing to tolerate. When you exceed it, new features pause until reliability improves."
      },
      {
        number: 4,
        title: "Own the build-vs-buy decision with data, not dogma",
        description:
          "Engineers default to building. The business defaults to buying. Neither instinct is reliably right. Evaluate each decision on total cost of ownership, strategic differentiation, and maintenance burden. Build what makes you unique; buy what makes you functional.",
        redFlag:
          "You're maintaining custom infrastructure that a commodity service could replace, or you've outsourced something core to your differentiation.",
        spotlight:
          "List everything your team maintains that isn't core to your product's differentiation. For each item, estimate the engineering hours spent per quarter. Now price the SaaS alternative. If the SaaS is cheaper and the capability isn't a differentiator, you're paying an engineer's salary to avoid a vendor bill. Conversely, check if any outsourced capability is actually core to your competitive advantage \u2014 that's the one you should own."
      },
      {
        number: 5,
        title: "Make deployment boring",
        description:
          "If deploying to production is an event that requires coordination, heroics, or anxiety, your delivery pipeline is broken. Invest in CI/CD, automated testing, feature flags, and rollback mechanisms until deployment is a non-event that happens multiple times a day.",
        redFlag:
          "Deployments happen on specific days, require multiple approvals, or make people nervous.",
        spotlight:
          "How many times did your team deploy to production last week? If the answer is less than five, ask why. Is it fear of breaking things (testing gap), process overhead (approval bottleneck), or cultural habit (we deploy on Tuesdays)? Each cause has a different fix. The goal isn't deployment frequency for its own sake \u2014 it's reducing the batch size of changes so that each deployment is low-risk and easy to debug."
      },
      {
        number: 6,
        title: "Security is architecture, not an afterthought",
        description:
          "Security bolted on after the fact is expensive, incomplete, and fragile. Build security into the architecture from day one \u2014 authentication, authorization, data encryption, input validation, and audit logging. The cost of security at design time is 10x less than at incident time.",
        redFlag:
          "Your security posture is maintained by a checklist rather than embedded in the system design.",
        spotlight:
          "Pick your most critical user flow. Trace a request from the client through every service it touches. At each boundary, ask: is authentication verified? Is authorization enforced? Is input validated? Is the data encrypted in transit and at rest? Is the action logged? If any answer is 'no' or 'I'm not sure,' that's your next security investment. Don't wait for a pentest to find the gaps \u2014 trace the flows yourself."
      }
    ]
  },
  {
    group: "The Team \u2014 Engineering Culture",
    items: [
      {
        number: 7,
        title: "Hire for taste, not just skill",
        description:
          "Technical skill is table stakes. What separates great engineers is judgment \u2014 knowing when to build, when to skip, when to refactor, and when to ship. Taste is the instinct for making the right trade-off, and it's harder to teach than any framework.",
        redFlag:
          "Your interview process tests algorithm knowledge but not design judgment or trade-off reasoning.",
        spotlight:
          "In your last five interviews, how much time was spent on algorithmic puzzles versus real design trade-offs? If the balance skews toward puzzles, you're filtering for contest programmers, not product engineers. Add a 'design a system under constraints' question where there's no right answer \u2014 only trade-offs. The candidates who articulate trade-offs clearly are the ones with taste."
      },
      {
        number: 8,
        title: "Protect maker time like it's oxygen",
        description:
          "Engineers need long, uninterrupted blocks to do deep work. Every meeting, Slack ping, and context switch has a cost that's invisible on the calendar but devastating to output. Your job is to be the shield that protects focused time.",
        redFlag:
          "Engineers have fewer than four uninterrupted hours per day for focused work.",
        spotlight:
          "Audit your team's calendars for the last week. How many engineers had a four-hour uninterrupted block every day? If the answer is few or none, your meeting culture is taxing your most expensive resource. Institute a 'maker schedule' \u2014 specific days or half-days where no meetings are allowed. The productivity gain from protected focus time is immediate and measurable."
      },
      {
        number: 9,
        title: "Code review is mentorship, not gatekeeping",
        description:
          "The best code review cultures treat reviews as collaborative learning, not adversarial inspection. Reviews should elevate the team's collective skill, share context across the codebase, and catch issues early \u2014 not block progress or enforce personal style preferences.",
        redFlag:
          "Code reviews take more than 24 hours on average, or the same reviewers block every PR.",
        spotlight:
          "Check your team's average review turnaround time. If it's over 24 hours, reviews are a bottleneck. Then look at the comments: are they teaching moments ('here's why this matters') or style mandates ('I'd write it differently')? If a comment doesn't prevent a bug, improve performance, or share important context, it shouldn't block the PR. Set a 24-hour turnaround SLA and retrain the team on what constitutes a blocking comment."
      },
      {
        number: 10,
        title: "Measure output, not activity",
        description:
          "Lines of code, commits, and story points are activity metrics. Customer impact, deployment frequency, lead time, and mean time to recovery are output metrics. Build a culture where people are evaluated on what they shipped and the impact it had, not on how busy they looked.",
        redFlag:
          "Your performance discussions focus on story points completed rather than customer or business outcomes.",
        spotlight:
          "For each engineer on your team, can you name one thing they shipped last quarter that had measurable impact? If you can't connect their work to an outcome, either the work didn't matter or you're not measuring the right things. Start tracking four metrics at the team level: deployment frequency, lead time for changes, change failure rate, and mean time to recovery. These tell you more about engineering health than any velocity chart."
      },
      {
        number: 11,
        title: "Documentation is a product, not a chore",
        description:
          "Code without documentation is a liability masquerading as an asset. Architecture decisions, API contracts, onboarding guides, and runbooks are products that serve your future team. Treat them with the same quality bar as shipping code.",
        redFlag:
          "New engineers take more than two weeks to make their first meaningful contribution.",
        spotlight:
          "Time your next new hire from day one to first merged PR. If it's over a week, your onboarding documentation is failing them. Ask your most recent hire: 'What was the hardest part of getting started?' Their answer is your documentation roadmap. Don't write a wiki \u2014 write the document that would have saved them the most time. That's always the right document to write first."
      }
    ]
  },
  {
    group: "The CTO \u2014 Self-Management",
    items: [
      {
        number: 12,
        title: "Translate between business and engineering \u2014 in both directions",
        description:
          "The CEO speaks in revenue, market, and strategy. Engineers speak in systems, trade-offs, and constraints. You are the translator. If the business doesn't understand why something takes time, or engineering doesn't understand why something matters, you've failed the translation.",
        redFlag:
          "The CEO says 'engineering is slow' while engineers say 'the business doesn't understand complexity.'",
        spotlight:
          "Think about the last time there was friction between engineering and the business. Was the root cause a genuine disagreement, or a translation failure? Most of the time, it's translation. Practice framing engineering decisions in business terms ('this refactor reduces our deployment risk, which protects revenue') and business priorities in engineering terms ('this feature matters because it directly affects our largest customer segment'). Both sides need to hear their own language."
      },
      {
        number: 13,
        title: "Stay technical enough to earn trust",
        description:
          "You don't need to write code every day, but you need to read it, review architectures, and understand the codebase well enough to call BS when needed. The CTO who manages from abstractions alone loses the trust of the engineering team and the ability to make informed decisions.",
        redFlag:
          "You can't explain a recent architectural decision in enough detail to debate it.",
        spotlight:
          "When was the last time you read a pull request, traced a bug, or reviewed an architecture doc in detail? If it's been more than two weeks, schedule time this week. The goal isn't to be the best engineer \u2014 it's to maintain enough context to ask the right questions, spot the right risks, and earn the respect that only comes from technical credibility."
      },
      {
        number: 14,
        title: "Say no to the shiny thing",
        description:
          "New frameworks, languages, and tools are seductive. Each one promises productivity gains and modern architecture. Most of them add complexity, fragment the stack, and create maintenance burden. Adopt new technology when the pain of the current tool exceeds the cost of switching, not when something new is trending.",
        redFlag:
          "Your stack includes technologies that were adopted because they were exciting rather than because they solved a problem.",
        spotlight:
          "List every technology in your stack. For each one, can you articulate the specific problem it solves better than the alternatives? If the answer is 'it was the new thing when we started' or 'an engineer wanted to try it,' that's a technology you're paying maintenance tax on without strategic benefit. You don't need to migrate away immediately, but stop adopting new tools without a clear problem statement and a comparison against boring alternatives."
      },
      {
        number: 15,
        title: "Build the team that doesn't need you",
        description:
          "The ultimate measure of a CTO isn't the code they write or the architectures they design \u2014 it's whether the engineering organization functions brilliantly without them. Develop tech leads, distribute decision-making, and create systems that scale beyond your personal involvement.",
        redFlag:
          "Architectural decisions stall when you're unavailable.",
        spotlight:
          "Do a two-week mental simulation: if you disappeared tomorrow, what would break? Not the personal relationships \u2014 the decisions, the prioritization, the technical direction. Each thing that would break is a single point of failure you haven't delegated. Pick the highest-risk one and start building the system or developing the person who can own it. Your goal is to make yourself unnecessary for day-to-day engineering decisions."
      },
      {
        number: 16,
        title: "Own the technology narrative for the company",
        description:
          "How the market perceives your technology matters \u2014 for recruiting, for sales, and for partnerships. You are the voice of the engineering organization to the outside world. Blog posts, conference talks, open source contributions, and technical brand building are part of the job, not distractions from it.",
        redFlag:
          "Candidates can't articulate what makes your engineering culture or technology distinctive.",
        spotlight:
          "Ask your last three engineering candidates: 'What do you know about our technology and engineering culture?' If they can't answer, your technical brand is invisible. You don't need a massive content program \u2014 start with one honest blog post about a real engineering challenge you solved. Authentic technical storytelling attracts the kind of engineers who want to solve hard problems, not just collect a paycheck."
      },
      {
        number: 17,
        title: "Remember that technology serves the mission, not the other way around",
        description:
          "The most elegant architecture in the world is worthless if it doesn't serve customers and the business. Technology is a means, not an end. Every technical decision should trace back to a user need, a business goal, or a strategic advantage. If it doesn't, it's self-indulgence disguised as engineering.",
        redFlag:
          "The team can explain how something works but not why it matters.",
        spotlight:
          "For your team's current top three priorities, ask each tech lead: 'Why does this matter to the business?' If the answer is technical ('it reduces latency') without connecting to impact ('which reduces abandonment in checkout, protecting $X in revenue'), the translation is incomplete. Every engineering initiative should have a one-sentence business justification that a non-technical person would understand. If you can't write that sentence, question whether the work is worth doing."
      }
    ]
  }
];

const ALL_PRINCIPLES = PRINCIPLES.flatMap((g) => g.items);

export function CtoPrinciplesScreen(): JSX.Element {
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
      `I'm reflecting on CTO Principle #${spotlight.number}: "${spotlight.title}"`,
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
        <h2>CTO Operating Principles</h2>
        <p>
          Seventeen principles for technology leadership &mdash; building platforms,
          growing engineering culture, and serving the mission through technology.
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
