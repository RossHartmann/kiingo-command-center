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
    group: "The Customer \u2014 Retention Architecture",
    items: [
      {
        number: 1,
        title: "Retention is the real growth engine",
        description:
          "Acquisition gets the headlines, but retention generates the compounding value. A 5% improvement in retention can increase lifetime value by 25-95%. The CCO who treats retention as a defensive metric instead of an offensive strategy is leaving the most powerful growth lever untouched.",
        redFlag:
          "Your company celebrates new logo wins but doesn't track or celebrate retention rate improvements.",
        spotlight:
          "Calculate your net revenue retention for the last four quarters. Is it trending up, down, or flat? If you don't track it quarterly, start today. Then decompose it: how much comes from gross retention (customers staying) versus expansion (customers buying more)? If gross retention is below 90%, you have a leaky bucket that no amount of acquisition can fill. Fix the bucket before you turn up the faucet."
      },
      {
        number: 2,
        title: "Define success before the customer signs",
        description:
          "If you wait until onboarding to define what success looks like, you've already lost. Success criteria should be established during the sales process and documented in the handoff. When customer and company agree on what 'winning' looks like before day one, everything that follows has a compass.",
        redFlag:
          "Your onboarding team regularly discovers that the customer's expectations don't match what was sold.",
        spotlight:
          "Pull your last five customer handoffs from sales. For each one, was there a documented success plan with specific, measurable outcomes the customer agreed to? If not, your post-sale team is starting every engagement with a discovery problem that should have been solved pre-sale. Work with the CRO to add a success criteria section to the sales handoff document. Three bullet points: what does success look like in 30, 90, and 365 days?"
      },
      {
        number: 3,
        title: "Onboarding is the product, not a phase",
        description:
          "The first 90 days determine whether a customer becomes a long-term partner or a churn statistic. Treat onboarding as a product with the same rigor as your core offering \u2014 defined milestones, measured outcomes, and continuous improvement. Sloppy onboarding is the most expensive mistake in customer success.",
        redFlag:
          "Time-to-value varies wildly between customers because onboarding isn't standardized.",
        spotlight:
          "What's your average time-to-first-value? Not time to complete onboarding \u2014 time until the customer gets the first tangible result they were promised. If you don't measure it, you can't improve it. Map your onboarding process step by step and identify where customers stall. The bottleneck is almost always the same two or three steps. Fix those steps and your entire downstream retention improves."
      },
      {
        number: 4,
        title: "Build a health score that actually predicts churn",
        description:
          "Most health scores are vanity metrics \u2014 green dashboards that turn red too late. A useful health score predicts churn 60-90 days before it happens, with enough specificity to drive intervention. If your health score doesn't change behavior, it's decoration.",
        redFlag:
          "Customers churn who were 'green' in your health scoring system last month.",
        spotlight:
          "Look at your last ten churned customers. What was their health score 90 days before churn? If more than two were green, your health score is broken. Work backward from churn: what signals were visible 90 days out that the score didn't capture? Common misses: declining engagement, key stakeholder departure, missed success milestones, or reduced support contact. Add those signals and backtest against historical churn."
      },
      {
        number: 5,
        title: "Make expansion a service, not a sell",
        description:
          "The best expansion revenue comes from customers who want more because you've delivered value, not from CSMs who hit upsell quotas. When expansion is a natural consequence of success, it feels like service. When it's a sales motion imposed on a success team, it erodes trust.",
        redFlag:
          "Customers describe their CSM as 'always trying to upsell' rather than 'always helping us succeed.'",
        spotlight:
          "Ask your CSMs: do they feel comfortable recommending an expansion to a customer right now? If not, why \u2014 is it because the customer hasn't achieved value yet, or because the CSM feels like they're selling instead of serving? The answer tells you whether your expansion motion is built on value or pressure. Expansion should follow a pattern: deliver success, document the ROI, identify the next problem, and offer the next solution. The order matters."
      },
      {
        number: 6,
        title: "Turn churned customers into your best teachers",
        description:
          "Every churned customer has a story, and that story contains intelligence you can't get anywhere else. Why did they leave? What would have changed their mind? What did they switch to? Systematic churn analysis is the most underused source of strategic insight in most companies.",
        redFlag:
          "You don't conduct exit interviews, or you conduct them but nothing changes as a result.",
        spotlight:
          "Review your churn data for the last two quarters. Can you categorize every churned customer by root cause \u2014 not 'they left' but 'why specifically'? Common buckets: didn't achieve value, lost champion, budget cut, competitive displacement, or poor fit from the start. If the largest bucket is something you can control (value delivery, champion management), that's your retention investment priority. If the largest bucket is something you can't control (budget cuts), focus your energy elsewhere."
      }
    ]
  },
  {
    group: "The Organization \u2014 Scale and Systems",
    items: [
      {
        number: 7,
        title: "Segment your customers, not just your coverage model",
        description:
          "Not all customers need the same level of touch. High-value enterprise accounts need strategic partnership. Mid-market accounts need efficient, proactive support. SMB accounts need scalable, self-serve tools. One-size-fits-all customer success is either too expensive for some or too thin for others.",
        redFlag:
          "Your CSMs manage enterprise and SMB accounts with the same playbook and the same ratio.",
        spotlight:
          "Map your customers by revenue and engagement level. Are your highest-value customers getting proportionally more attention? Are your lower-value customers being served by scalable tools rather than expensive human touch? If you're spreading CSM capacity evenly, you're over-serving some customers and under-serving others. Design at least three tiers: high-touch (strategic), mid-touch (proactive), and tech-touch (automated). Each tier should have a distinct playbook."
      },
      {
        number: 8,
        title: "Build playbooks, then improve them continuously",
        description:
          "Playbooks for onboarding, QBRs, risk mitigation, and expansion ensure consistency and enable scale. But a playbook that never changes becomes stale. Build the playbook, measure its effectiveness, and improve it quarterly. The playbook is a living document, not a policy manual.",
        redFlag:
          "Your team follows playbooks that haven't been updated in six months, or each CSM runs their own process.",
        spotlight:
          "Pick your most critical playbook \u2014 probably onboarding or risk mitigation. When was it last updated? Does the current version reflect what your best CSMs actually do, or is it outdated? The best playbook update method: shadow your top performer, document what they do differently from the playbook, and incorporate the differences. Your best CSMs are always ahead of the playbook \u2014 your job is to capture their innovations and scale them."
      },
      {
        number: 9,
        title: "Make the voice of the customer impossible to ignore",
        description:
          "Customer feedback shouldn't live in a CS silo \u2014 it should flow to product, engineering, sales, and leadership with enough structure to drive action. Build systems that aggregate, categorize, and route customer insights to the teams that can act on them. The CCO is the customer's lobbyist inside the company.",
        redFlag:
          "Product decisions are made without customer input, or customer feedback reaches product as anecdotes rather than data.",
        spotlight:
          "How does customer feedback reach your product team today? If the answer is 'through CSM requests' or 'in quarterly meetings,' the signal is too filtered and too slow. Build a structured feedback loop: tag every piece of customer feedback by theme, quantify it (how many customers, how much revenue at stake), and route the top themes to product monthly. Product teams respond to structured data, not ad hoc requests."
      },
      {
        number: 10,
        title: "Measure what matters: outcomes, not activities",
        description:
          "QBRs completed, emails sent, and health checks run are activity metrics. Net revenue retention, time-to-value, and customer satisfaction are outcome metrics. Activities are inputs; outcomes are results. Manage to outcomes and let your team find the best activities to achieve them.",
        redFlag:
          "Your team dashboard shows activities completed but not customer outcomes achieved.",
        spotlight:
          "Look at your CS dashboard right now. Count the activity metrics (calls made, QBRs run, emails sent) versus the outcome metrics (NRR, CSAT, time-to-value, expansion rate). If activities outnumber outcomes, you're managing effort, not impact. Restructure the dashboard: outcomes at the top, activities as supporting detail. When outcomes are healthy, the activities are working. When outcomes are unhealthy, the right activities will change \u2014 but only if you're watching the right numbers."
      },
      {
        number: 11,
        title: "Invest in customer education as a scale lever",
        description:
          "The most scalable way to drive adoption and reduce support burden is to teach customers to help themselves. Knowledge bases, training programs, certification paths, and community forums compound over time. Every customer who learns to solve their own problem is a customer who doesn't need a support ticket.",
        redFlag:
          "Your support ticket volume grows proportionally with your customer base because there's no self-serve education.",
        spotlight:
          "What percentage of your support tickets could be resolved by a well-written help article or a short video? If it's above 30%, your education investment is underweight. Identify your top ten support ticket categories and build self-serve content for each. Then measure deflection: how many tickets does each article prevent? The ROI on customer education is one of the highest in the entire business \u2014 it reduces costs while improving satisfaction."
      }
    ]
  },
  {
    group: "The CCO \u2014 Self-Management",
    items: [
      {
        number: 12,
        title: "Earn your seat at the revenue table",
        description:
          "Customer success isn't a support function \u2014 it's a revenue function. Net revenue retention, expansion revenue, and renewal bookings are financial contributions that belong in the revenue conversation. If you're not presenting alongside the CRO, you're positioned as cost center, not growth driver.",
        redFlag:
          "CS is discussed in operational reviews but not in revenue reviews.",
        spotlight:
          "Can you state, with confidence, how much revenue your team directly influenced last quarter \u2014 renewals protected, expansions closed, churn prevented? If not, build the attribution model this month. When you can say 'CS influenced $X in revenue this quarter,' you change your positioning from cost center to growth engine. That reframing affects your budget, your headcount, and your influence."
      },
      {
        number: 13,
        title: "Stay close to the customer, even as you scale",
        description:
          "The CCO who manages from dashboards loses the empathy that makes them effective. Block time every week for direct customer interaction \u2014 calls, QBRs, escalations. The insights that change your strategy never come from reports; they come from hearing a customer's frustration firsthand.",
        redFlag:
          "Your last direct customer conversation was more than two weeks ago.",
        spotlight:
          "How many customer conversations did you have last week? Not your team \u2014 you, personally. If the answer is zero, schedule three for this week: one happy customer, one at-risk customer, one recently churned. The range matters. Happy customers tell you what to protect. At-risk customers tell you what to fix. Churned customers tell you what you missed. All three perspectives are essential."
      },
      {
        number: 14,
        title: "Build a team that thinks in outcomes, not tickets",
        description:
          "The CSM who measures success by activities completed will always be busy but rarely impactful. Hire and develop people who think about customer outcomes, not task lists. The question isn't 'did I do the QBR?' but 'is this customer achieving the result they hired us for?'",
        redFlag:
          "Your CSMs describe their job in terms of activities rather than customer results.",
        spotlight:
          "In your next round of 1:1s, ask each CSM: 'For your top account, what outcome are they trying to achieve and are they on track?' If the answer is a list of activities ('I did the QBR, sent the report, scheduled the training'), the mindset is task-oriented. If the answer is outcome-oriented ('they're trying to reduce onboarding time by 40%, and we're at 25% so far'), you have a strategic partner. The difference is coachable \u2014 start coaching it."
      },
      {
        number: 15,
        title: "Partner with product, don't just file requests",
        description:
          "The CCO-CPO relationship is one of the most important in the company. You bring customer reality; they bring product vision. If the relationship is transactional ('here are our feature requests'), it's broken. Build a strategic partnership where customer insights shape the roadmap and product strategy informs customer conversations.",
        redFlag:
          "Your product team sees CS as a feature request pipeline rather than a strategic partner.",
        spotlight:
          "How often do you meet with the CPO? Is the conversation about feature requests, or about customer problems and market trends? If it's mostly requests, restructure the conversation: bring three customer problems (not solutions), the revenue impact of each, and data on frequency. Let product propose the solutions. When you bring problems with data, you're a strategic partner. When you bring solutions, you're a middleman."
      },
      {
        number: 16,
        title: "Protect your team from burnout",
        description:
          "Customer success is emotionally taxing \u2014 CSMs absorb customer frustration, manage escalations, and carry the weight of churn they can't always prevent. Your job is to build sustainable workloads, celebrate wins, and create space for recovery. A burned-out CS team delivers burned-out customer experiences.",
        redFlag:
          "CSM turnover is above 20% annually and exit interviews cite workload as the primary reason.",
        spotlight:
          "Check your CSMs' book of business ratios. Are any managing more accounts or more revenue than they can reasonably serve well? Look at after-hours work patterns and escalation frequency. If some CSMs are consistently working evenings or handling escalations alone, the load isn't distributed. Have an honest conversation with your team this week: 'What's one thing about your workload that's unsustainable?' Their answers are your retention roadmap \u2014 for employees, not just customers."
      },
      {
        number: 17,
        title: "Champion the customer lifecycle, not just post-sale",
        description:
          "The customer experience doesn't start at handoff \u2014 it starts at first touch. And it doesn't end at renewal \u2014 it extends through advocacy, referral, and community. The CCO who owns the full lifecycle, or at least influences it, builds a customer experience that compounds rather than fragments.",
        redFlag:
          "The customer experience feels like three different companies: marketing, sales, and post-sale.",
        spotlight:
          "Map your customer lifecycle from first marketing touch through Year 3 of the relationship. At each stage transition, who owns the experience? Where does context get lost? Where does the customer have to re-explain themselves? Each re-explanation is a handoff failure. You may not own every stage, but you should influence every transition. Propose a lifecycle review meeting with marketing, sales, and CS \u2014 quarterly, focused on one question: where does the customer feel the seams?"
      }
    ]
  }
];

const ALL_PRINCIPLES = PRINCIPLES.flatMap((g) => g.items);

export function CcoPrinciplesScreen(): JSX.Element {
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
      `I'm reflecting on CCO Principle #${spotlight.number}: "${spotlight.title}"`,
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
        <h2>CCO Operating Principles</h2>
        <p>
          Seventeen principles for customer success leadership &mdash; driving retention,
          enabling expansion, and championing the customer lifecycle.
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
