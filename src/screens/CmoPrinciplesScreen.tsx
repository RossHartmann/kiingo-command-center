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
    group: "The Market \u2014 Strategic Positioning",
    items: [
      {
        number: 1,
        title: "Own the narrative before the market writes it for you",
        description:
          "You don't get to choose whether people tell your story \u2014 you only get to choose whether you told it first. Shape how the market understands you, or accept the default they invent.",
        redFlag:
          "A prospect describes what you do and it doesn't match how you'd describe it.",
        spotlight:
          "Ask three recent prospects how they'd describe your company to a colleague. Don't prompt them \u2014 just listen. If their description diverges from yours, the market is writing your narrative for you. The fix isn't a rebrand \u2014 it's relentless consistency in how you show up at every touchpoint. Your story needs to be simple enough that other people can retell it accurately."
      },
      {
        number: 2,
        title: "Know your buyer better than they know themselves",
        description:
          "Demographics are table stakes. You need to know what keeps them up at night, what they've already tried, what they're afraid of getting wrong, and what \"success\" looks like in their words \u2014 not yours.",
        redFlag:
          "Your personas describe job titles and company sizes but not fears, motivations, or decision criteria.",
        spotlight:
          "Pull up your buyer personas. Do they read like a LinkedIn profile or like a journal entry? If you can't articulate your buyer's biggest fear about making this purchase decision, you don't know them well enough. Block time this week to interview one recent customer and one lost deal. Ask: \"What almost stopped you from buying?\" That answer is more valuable than any demographic data."
      },
      {
        number: 3,
        title: "Position against the real alternative, not the obvious competitor",
        description:
          "Your biggest competitor usually isn't the other vendor \u2014 it's the status quo, an internal hire, or doing nothing. Position against the decision your buyer is actually making, not the one you wish they were making.",
        redFlag:
          "Your competitive battlecards focus on feature comparisons instead of why buyers don't buy at all.",
        spotlight:
          "Look at your last ten lost deals. How many lost to a competitor versus how many chose to do nothing, hire internally, or stick with the status quo? If the majority didn't buy at all, your positioning is solving the wrong problem. You're arguing why you're better than the alternative when you should be arguing why the alternative isn't good enough."
      },
      {
        number: 4,
        title: "Make one bet per quarter, not ten",
        description:
          "Spreading budget across every channel guarantees mediocrity everywhere. Pick the one channel or campaign that could move the number, fund it properly, measure it honestly, and kill it or double down in 90 days.",
        redFlag:
          "You can't name which initiative is the most important this quarter because they all feel equally important.",
        spotlight:
          "List every marketing initiative running right now. Now rank them by expected pipeline impact. If you can't rank them \u2014 or if the top five all have roughly equal investment \u2014 you're spreading thin. Pick the top one, give it disproportionate resources, and explicitly deprioritize the bottom three. The discipline of concentration is what separates marketing that moves numbers from marketing that stays busy."
      },
      {
        number: 5,
        title: "Treat brand as a compounding asset, not a cost center",
        description:
          "Performance marketing rents attention. Brand earns it permanently. Every case study, every thought leadership piece, every consistent touchpoint compounds over years. The CMO who sacrifices brand for short-term leads is liquidating the company's most durable asset.",
        redFlag:
          "You can't articulate what you've built this quarter that will still generate value in two years.",
        spotlight:
          "Split your marketing activities into two columns: things that stop producing value the moment you stop spending, and things that keep producing value after the investment. If the first column dominates, you're renting all your attention. This quarter, shift at least 20% of effort toward assets that compound \u2014 case studies, evergreen content, brand consistency. Future you will thank present you."
      }
    ]
  },
  {
    group: "The Pipeline \u2014 Revenue Partnership",
    items: [
      {
        number: 6,
        title: "Revenue is your metric, not impressions",
        description:
          "MQLs, traffic, and engagement are interesting. Revenue influenced and pipeline generated are what matter. If marketing can't trace its work to closed deals, it's decorating, not driving.",
        redFlag:
          "Your marketing dashboard doesn't show pipeline contribution or revenue influence.",
        spotlight:
          "Open your marketing dashboard right now. How many clicks does it take to see revenue impact? If the answer is more than one \u2014 or if it's not there at all \u2014 you're measuring activity, not impact. This week, add pipeline generated and revenue influenced to the top of your primary dashboard. Everything else is supporting context. Leading with revenue changes how your entire team thinks about their work."
      },
      {
        number: 7,
        title: "Align with sales on definitions, not just leads",
        description:
          "If marketing and sales disagree on what a qualified lead looks like, every handoff is a source of friction. Get in a room, define it together, write it down, and revisit it quarterly. Shared language prevents shared blame.",
        redFlag:
          "Sales says leads are bad; marketing says sales doesn't follow up. Neither has data.",
        spotlight:
          "Schedule a 30-minute session with your sales counterpart this week with one agenda item: define a qualified lead in five bullet points that you both sign off on. Include firmographic criteria, behavioral signals, and a timeline expectation. Write it down. Share it with both teams. When the argument about lead quality resurfaces \u2014 and it will \u2014 you'll have a document to point to instead of opinions to trade."
      },
      {
        number: 8,
        title: "Build proof, not promises",
        description:
          "Testimonials, case studies, ROI data, and customer stories do more selling than any campaign. Your job is to systematically harvest proof from every successful customer and make it impossible for prospects to ignore.",
        redFlag:
          "You have fewer than three documented case studies per offering.",
        spotlight:
          "Count your case studies right now. Then count the number of successful customers who could have been case studies but weren't asked. The gap between those numbers is unrealized credibility. Build a system: every customer who hits a milestone gets a case study request within 30 days. Make it easy \u2014 a 20-minute interview, you write the draft. Proof is the most underleveraged asset in most marketing organizations."
      },
      {
        number: 9,
        title: "Shorten the distance between content and conversion",
        description:
          "Every piece of content should have a clear next step. Not a generic \"contact us\" \u2014 a specific, low-friction action that moves the buyer forward. If your content educates but doesn't convert, it's a library, not a funnel.",
        redFlag:
          "Your highest-traffic content has the lowest conversion rate and no one has investigated why.",
        spotlight:
          "Pull your top ten pages by traffic. For each one, ask: what is the single most logical next step a reader should take? Is that step obvious, specific, and low-friction? If your best content ends with a generic CTA or no CTA at all, you're generating awareness with no mechanism to capture intent. Fix the top three pages this week \u2014 the traffic is already there."
      },
      {
        number: 10,
        title: "Kill campaigns that flatter your ego but don't move the number",
        description:
          "The beautiful brand film, the clever social campaign, the industry award submission \u2014 ask honestly whether it moves pipeline or whether it makes the marketing team feel good. Both can be valuable, but don't confuse one for the other.",
        redFlag:
          "You spend more time on the campaign recap deck than you spent analyzing its pipeline impact.",
        spotlight:
          "Review your last three campaigns. For each, write two numbers: hours invested and pipeline generated. If any campaign consumed significant resources but produced negligible pipeline, ask whether it served a genuine brand purpose or whether it was a vanity project. The honest answer is often uncomfortable. Marketing that moves numbers often looks unglamorous \u2014 and that's fine."
      }
    ]
  },
  {
    group: "The CMO \u2014 Self-Management",
    items: [
      {
        number: 11,
        title: "Be the voice of the customer in every room",
        description:
          "You are the only executive whose job is to represent the market's perspective internally. When product, sales, or leadership drift from what customers actually care about, it's your job to pull them back \u2014 with data, not opinion.",
        redFlag:
          "You haven't directly spoken to a customer or prospect in the last two weeks.",
        spotlight:
          "In your last three executive meetings, how many times did you cite a specific customer quote, data point, or market insight that changed the direction of the conversation? If the answer is zero, you're attending meetings as a department head, not as the voice of the market. Before your next leadership meeting, arm yourself with one fresh customer insight that challenges an internal assumption."
      },
      {
        number: 12,
        title: "Say no to requests that dilute the strategy",
        description:
          "Every department wants marketing to help with their thing. Sales wants a one-pager. Product wants a launch video. The CEO wants a new website. Your job is to filter ruthlessly: does this advance the quarterly bet, or does it fragment the team's focus?",
        redFlag:
          "More than 30% of your team's time goes to reactive requests rather than strategic initiatives.",
        spotlight:
          "Track your team's time for one week. Categorize everything as either \"strategic\" (advances the quarterly bet) or \"reactive\" (someone else's request). If reactive work exceeds 30%, your team is functioning as an internal agency, not a strategic function. The fix isn't saying no rudely \u2014 it's having a visible priority list that makes the trade-off obvious. \"We can do that \u2014 which of these should we pause?\""
      },
      {
        number: 13,
        title: "Hire specialists, not generalists, at scale",
        description:
          "Early on, you need versatile marketers. As you grow, you need depth \u2014 someone who is exceptional at demand gen, someone who owns content, someone who lives in analytics. Generalists plateau; specialists compound.",
        redFlag:
          "Everyone on the team does a little of everything but no one is genuinely excellent at one thing.",
        spotlight:
          "For each person on your team, can you name their one superpower \u2014 the thing they do better than anyone else? If you can't, you have a team of generalists. That works at three people; it breaks at eight. For your next hire, resist the urge to find someone who can \"do a bit of everything\" and instead hire the specialist who fills your biggest capability gap."
      },
      {
        number: 14,
        title: "Instrument everything before you optimize anything",
        description:
          "You can't improve what you can't see. Before launching the next campaign, make sure attribution is working, UTMs are consistent, the CRM is clean, and you can trace a lead from first touch to closed deal. Optimization without instrumentation is guessing.",
        redFlag:
          "Someone asks \"which channel drove this deal?\" and the answer requires a 30-minute investigation.",
        spotlight:
          "Pick a closed deal from last month and trace it backward: first touch, every marketing interaction, handoff to sales, close. If that journey is clear and documented in your systems, your instrumentation is working. If it took detective work, you're flying blind. Fix the plumbing before you optimize the campaigns \u2014 otherwise you're optimizing based on incomplete data, which is worse than not optimizing at all."
      },
      {
        number: 15,
        title: "Protect creative quality like a product manager protects code quality",
        description:
          "Sloppy creative \u2014 inconsistent brand, typos, generic stock photos, copy that sounds like everyone else \u2014 erodes trust in ways that are invisible until they compound. Set a bar, enforce it, and treat brand standards as non-negotiable, not aspirational.",
        redFlag:
          "You see marketing materials go out that you wouldn't personally endorse and you say nothing.",
        spotlight:
          "Pull up the last five pieces of marketing your team shipped. Would you be proud to show each one to your most important prospect? If any of them make you wince, your quality bar has slipped. The fix isn't more review cycles \u2014 it's a clearer definition of \"what good looks like\" that the team can self-enforce. Write it down, show examples, and make it a hiring criterion."
      },
      {
        number: 16,
        title: "Stay dangerous with the tools",
        description:
          "You don't need to be the best operator, but you need to be literate enough to know what's possible and what's BS. Spend time in the platforms \u2014 the ad manager, the analytics, the automation tool. A CMO who can't open the hood is a CMO who gets managed by vendors.",
        redFlag:
          "You rely entirely on someone else's interpretation of the data and have never pulled the raw numbers yourself.",
        spotlight:
          "When was the last time you personally logged into your analytics platform, ad manager, or marketing automation tool and pulled data yourself? If you can't remember, you're outsourcing your judgment to whoever controls the dashboard. Block 30 minutes this week to explore one platform directly. You'll notice things that never make it into the summary report \u2014 and those things often matter most."
      },
      {
        number: 17,
        title: "Tell the CEO what's true, not what's comfortable",
        description:
          "When a channel isn't working, say so. When attribution is messy, admit it. When the pipeline is light, flag it early. The CMO who spins the narrative internally destroys their own credibility. Earned trust compounds faster than manufactured optimism.",
        redFlag:
          "Your board deck tells a different story than your internal team retrospective.",
        spotlight:
          "Compare your last board or executive update with what you told your team in the retrospective. If the tone, emphasis, or conclusions differ, you're maintaining two versions of reality. That's unsustainable and it erodes trust in both directions. The hardest version of this principle: when the numbers are bad, lead with them. \"Pipeline is 30% below target. Here's why and here's the plan.\" That sentence builds more credibility than any amount of spin."
      }
    ]
  }
];

const ALL_PRINCIPLES = PRINCIPLES.flatMap((g) => g.items);

export function CmoPrinciplesScreen(): JSX.Element {
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
      `I'm reflecting on CMO Principle #${spotlight.number}: "${spotlight.title}"`,
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
        <h2>CMO Operating Principles</h2>
        <p>
          Seventeen principles for marketing leadership &mdash; building brand,
          driving pipeline, and earning revenue partnership.
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
