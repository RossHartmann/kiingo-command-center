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
    group: "The Machine — Systems Thinking",
    items: [
      {
        number: 1,
        title: "Be obsessed with the machine",
        description:
          "Don't just fill the funnel — make everything downstream convert. The system matters more than any single input.",
        redFlag:
          "You're celebrating top-of-funnel volume while downstream conversion is flat.",
        spotlight:
          "This week, pick one conversion step in your funnel and trace ten real examples through it end-to-end. Don't look at the aggregate — look at the individual stories. Where did they stall? What was the actual friction? The machine only improves when you see it at the unit level, not the dashboard level."
      },
      {
        number: 2,
        title: "Know your numbers cold",
        description:
          "Every conversion rate, every unit economic. If you can't recite it, you can't improve it.",
        redFlag:
          "Someone asks a conversion rate and you say \"I'll pull that up.\"",
        spotlight:
          "Quiz yourself right now: what's your CAC? Your LTV? Your close rate from qualified lead to signed deal? Your gross margin per offering? If you hesitated on any of those, block 20 minutes today to nail them down. A CEO who can't rattle off the core economics in a board meeting is flying blind — and everyone in the room knows it."
      },
      {
        number: 3,
        title: "Work the bottleneck",
        description:
          "Identify the one constraint that matters most right now and own it personally. Everything else is noise until the bottleneck moves.",
        redFlag:
          "You're improving three things at once and none of them is the constraint.",
        spotlight:
          "Write down the one thing that, if it doubled overnight, would change the trajectory of the business. That's your bottleneck. Now ask: did you personally spend time on it this week? If your calendar doesn't reflect the bottleneck, your calendar is wrong. Everything else that feels productive is just comfortable busywork."
      },
      {
        number: 4,
        title: "Think in 90-day bets",
        description:
          "Hard quarterly checkpoints with explicit \"not doing\" lists. Short cycles force clarity and kill drift.",
        redFlag:
          "You can't name what you're explicitly not doing this quarter.",
        spotlight:
          "Pull up your current quarter's priorities. Now write the \"not doing\" list — the things that are tempting, maybe even good ideas, but that you're explicitly deferring. If that list doesn't exist, your priorities aren't real — they're wishes. The \"not doing\" list is what gives the \"doing\" list its teeth."
      },
      {
        number: 5,
        title: "Stay close to customers",
        description:
          "Dashboards and reports abstract you from reality. Maintain direct contact with the people who pay you — their words are the ground truth your metrics approximate.",
        redFlag:
          "You haven't talked to a customer directly in over two weeks.",
        spotlight:
          "Block one hour this week for a customer conversation with no agenda beyond listening. Not a QBR, not a renewal call — a genuine \"how are things going?\" conversation. The insights that change strategy never come from dashboards. They come from the sentence a customer says that surprises you."
      }
    ]
  },
  {
    group: "The People — Leadership",
    items: [
      {
        number: 6,
        title: "Delegate outcomes, not tasks",
        description:
          "Make people owners, not executors. Define the result, then get out of the way.",
        redFlag:
          "You're writing the steps instead of defining what done looks like.",
        spotlight:
          "Think about the last thing you delegated. Did you describe what success looks like, or did you describe how to do it? If you handed over steps, you created an executor. Try this instead: \"Here's the outcome I need by Friday. Here's why it matters. How you get there is up to you.\" Then actually let go. The discomfort you feel is the delegation working."
      },
      {
        number: 7,
        title: "Have uncomfortable conversations faster",
        description:
          "Don't wait for issues to surface organically. The cost of delay always exceeds the cost of discomfort.",
        redFlag:
          "You've rehearsed it in your head three times but haven't scheduled it.",
        spotlight:
          "There's a conversation you've been avoiding. You know exactly which one. The reason you're delaying isn't that you need more information — it's that it's uncomfortable. Here's the move: send the calendar invite today with a simple framing. The conversation will never feel easier than it does right now, and the problem is compounding while you wait."
      },
      {
        number: 8,
        title: "Make people decisions faster",
        description:
          "Not recklessly — but every week of delay is a week the machine runs suboptimally. Bias toward action.",
        redFlag:
          "You've said \"let's give them another month\" more than once about the same person.",
        spotlight:
          "If you're honest with yourself, you probably already know the answer on the person you're hesitating about. The extra month of data rarely changes the conclusion — it just delays the pain. Ask yourself: if this role were open today, would I hire this person into it? If the answer isn't a clear yes, you have your answer. Act on it this week."
      },
      {
        number: 9,
        title: "Default to transparency",
        description:
          "Share the real picture so people rise to the challenge. Shielding the team from reality breeds fragility.",
        redFlag:
          "You're crafting a \"version\" of the update instead of sharing the actual numbers.",
        spotlight:
          "Before your next team update, resist the urge to soften the numbers or spin the narrative. Share the raw picture and trust your team to handle it. The teams that outperform aren't the ones with better news — they're the ones with better information. Transparency is how you build the muscle for hard times."
      },
      {
        number: 10,
        title: "Tell the story repeatedly",
        description:
          "Be the chief meaning-maker. Articulate where the company is going and why — more often than feels necessary. By the time you're tired of saying it, people are just starting to hear it.",
        redFlag:
          "Your team can't articulate the strategy the same way you would.",
        spotlight:
          "Ask three people on your team this week: \"What are we trying to do and why?\" Don't prompt them — just listen. If their answers diverge from yours, the problem isn't their understanding — it's your repetition. The story needs to be told 10x more than feels natural. When you're bored of saying it, they're just starting to internalize it."
      },
      {
        number: 11,
        title: "Transmit conviction in every interaction",
        description:
          "Every email, meeting, Slack message, and hallway conversation is a broadcast. You're either injecting energy, optimism, and clarity — or you're letting entropy win. Nobody else in the org has the same amplification effect.",
        redFlag:
          "You sent an email or walked into a meeting on autopilot and left the energy the same or lower than when you arrived.",
        spotlight:
          "Think about your last five interactions today — Slack messages, calls, emails, walk-and-talks. In how many did you consciously bring energy, clarity, and conviction? The CEO's emotional state is contagious in a way nobody else's is. When you show up flat, uncertain, or distracted, that radiates outward fast. This isn't about toxic positivity or cheerleading — it's about the fact that your belief in where the company is going is the fuel that keeps everyone else moving. If you're not transmitting it, nobody is."
      },
      {
        number: 12,
        title: "Be the accelerant",
        description:
          "Most people default to a comfortable pace. Your job is to compress timelines, ask \"why not this week?\" and make the team feel the gap between where they are and where they need to be. Not anxiety — urgency. Urgency comes with clarity about what matters; anxiety comes from confusion about what matters.",
        redFlag:
          "Someone said \"we're hoping to have that done by end of month\" and you didn't push back on the timeline.",
        spotlight:
          "Look at the three biggest initiatives your team is working on right now. For each one, ask: what would it take to deliver this in half the time? Not as a thought experiment — as a real question with a real answer. Most timelines have slack built in because nobody challenged them. The CEO is the person who makes comfortable pacing feel uncomfortable. Not by creating panic, but by making the cost of delay visible. Every week of drift is a week your competitor isn't drifting."
      },
      {
        number: 13,
        title: "Make the scoreboard visible",
        description:
          "If nobody on your team can tell whether they're winning or losing on any given week, you haven't defined the game. Clear metrics and rocks turn ambiguity into accountability — and let good people self-correct before you have to intervene.",
        redFlag:
          "You ask someone how their quarter is going and they answer with activity instead of outcomes.",
        spotlight:
          "Ask each of your direct reports this week: \"Are you winning or losing right now?\" If they hesitate, or answer with what they've been busy doing instead of where they stand against a clear target, the scoreboard is broken. People can't perform at their best when the goal is fuzzy. Define the three to five numbers that matter for each role, make them visible, and review them weekly. The scoreboard doesn't create pressure — it creates clarity. And clarity is a gift."
      },
      {
        number: 14,
        title: "Ask for what you need",
        description:
          "Your growth rate is limited by your willingness to ask. Ask customers for referrals, testimonials, and case studies. Ask your team for more. Ask partners to commit. The value you deliver earns you the right to ask — but only if you actually do it.",
        redFlag:
          "A customer told you they loved the work and you said \"thanks\" instead of \"would you introduce me to someone who needs this?\"",
        spotlight:
          "Think about your last ten client interactions. In how many did you make a specific ask — a referral, a testimonial, a case study, an introduction? If the number is low, you're leaving compound growth on the table. You're comfortable delivering value. The muscle you need to build is requesting value back. Not aggressively — but consistently and unapologetically. Every unasked ask is a missed flywheel turn."
      },
      {
        number: 15,
        title: "Hire ahead of the curve",
        description:
          "Recruiting is the single highest-leverage CEO activity. You can't delegate outcomes to people you haven't hired yet. Treat your pipeline of people like you treat your pipeline of revenue.",
        redFlag:
          "A role has been \"open\" for months but you haven't personally sourced or sold a candidate this week.",
        spotlight:
          "Look at your org chart six months from now. Who's missing? Now ask: what did you personally do this week to fill that gap? If the answer is \"I posted the role\" or \"the recruiter is on it,\" you're underinvesting. For key hires, the CEO is the closer. Block sourcing time on your calendar the same way you'd block time for your biggest customer."
      }
    ]
  },
  {
    group: "The CEO — Self-Management",
    items: [
      {
        number: 16,
        title: "Work on the company, not in it",
        description:
          "Your competence is your biggest trap. Every hour in execution is an hour not spent on leverage.",
        redFlag: "You're the one writing the deliverable.",
        spotlight:
          "Audit your last week honestly. How many hours did you spend doing work that someone else could do — maybe not as well, but well enough? That gap between \"good enough\" and \"perfect\" is where your leverage dies. Your job isn't to produce the best work — it's to build the system that produces good work without you."
      },
      {
        number: 17,
        title: "Make yourself replaceable",
        description:
          "Every time you do something, ask how someone else does it next time. Your job is to build the machine, not be it.",
        redFlag:
          "You did the same thing last quarter and there's still no playbook.",
        spotlight:
          "Pick one thing you did this week that only you can do. Now ask: is that actually true, or is it just that no one else has been shown how? Before you move on, spend 15 minutes documenting the decision framework or recording a quick Loom. The compound interest on replaceability is enormous — every playbook you write buys back future hours permanently."
      },
      {
        number: 18,
        title: "Protect the compounding stuff",
        description:
          "Relationships, nurture systems, case studies — these compound quietly. Don't sacrifice them for what feels urgent today.",
        redFlag:
          "You skipped the relationship-building block on your calendar for the third week in a row.",
        spotlight:
          "The urgent will always crowd out the important unless you defend it structurally. Look at your calendar for the next two weeks. Is there protected time for the things that compound — relationship nurture, content creation, case study collection? If it's not on the calendar, it's not real. The things that compound are invisible until they're not — and by then you've either built the asset or you haven't."
      },
      {
        number: 19,
        title: "Say no to good things",
        description:
          "Killing zombies is easy. The real discipline is declining attractive opportunities that don't fit. Every yes is a no to something else — make the trade-off explicit.",
        redFlag:
          "You said yes because it was exciting, not because it advanced the 90-day bet.",
        spotlight:
          "Think about the last opportunity you said yes to. Now name what you implicitly said no to by taking it on. If you can't name the trade-off, you didn't make a decision — you just accumulated. The discipline isn't saying no to bad ideas. It's saying no to good ideas that don't fit the current bet. Practice the phrase: \"That's a great idea — and we're not doing it this quarter.\""
      },
      {
        number: 20,
        title: "Kill things explicitly",
        description:
          "No zombie projects draining focus. If it's not a yes, make it a declared no.",
        redFlag:
          "You said \"let's revisit that\" more than two weeks ago and haven't.",
        spotlight:
          "Right now, name three initiatives that are technically still alive but haven't received real attention in the last month. Those are your zombies. They're consuming mental bandwidth and giving your team ambiguous signals. Send the message today: \"We're stopping X. Here's why. Here's what we're focusing on instead.\" The clarity is a gift to everyone, including yourself."
      },
      {
        number: 21,
        title: "Protect your energy for decisions",
        description:
          "Decisions compound more than production. Guard your decision-making capacity like the scarce resource it is.",
        redFlag:
          "You're exhausted before the meeting where the actual decision gets made.",
        spotlight:
          "Map your energy curve for a typical day. When is your sharpest window? Now look at what's scheduled there. If your best thinking hours are consumed by status updates and email, you're spending your highest-value resource on your lowest-value activities. Move the real decisions — hiring calls, strategy sessions, hard trade-offs — into your peak window. Everything else can have your B-game."
      }
    ]
  }
];

const ALL_PRINCIPLES = PRINCIPLES.flatMap((g) => g.items);

export function CeoPrinciplesScreen(): JSX.Element {
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
      `I'm reflecting on CEO Principle #${spotlight.number}: "${spotlight.title}"`,
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
        <h2>CEO Operating Principles</h2>
        <p>
          Twenty-one principles distilled from coaching — honest, first-principles
          guidance to return to regularly.
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
