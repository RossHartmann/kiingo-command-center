import { useState } from "react";
import { useAppActions } from "../state/appState";

interface CeoQuestion {
  number: number;
  title: string;
  coreQuestion: string;
  sharpenerQuestion: string;
  context: string;
  layer: "operating" | "deeper";
}

const QUESTIONS: { group: string; layer: "operating" | "deeper"; items: CeoQuestion[] }[] = [
  {
    group: "Operating Questions",
    layer: "operating",
    items: [
      {
        number: 1,
        title: "The Constraint",
        coreQuestion: "What is the single biggest constraint on our growth right now, and am I personally doing something about it this week?",
        sharpenerQuestion: "What's the one thing that, if solved, would make everything else easier?",
        context:
          "This is the Theory of Constraints applied to CEO thinking. There's always one bottleneck. If you're not working on it, you're busy but not effective. The bottleneck changes — the question stays the same.",
        layer: "operating"
      },
      {
        number: 2,
        title: "The Customer",
        coreQuestion: "What do our customers actually want that they're not telling us, and what are they telling us that we're not hearing?",
        sharpenerQuestion: "What are customers doing after they leave us, and why?",
        context:
          "The first half is about latent needs — things they don't know to ask for. The second half is about signals you're ignoring. The gap between what customers say and what they do is where the real answer lives.",
        layer: "operating"
      },
      {
        number: 3,
        title: "The People",
        coreQuestion: "Do I have the right people in the right seats, and am I being honest with myself about the ones who aren't working?",
        sharpenerQuestion: "If I were hiring for every role today from scratch, who would I rehire?",
        context:
          "This is the one CEOs avoid the longest because it's the most uncomfortable. It's not a one-time question — it's constant. Every quarter, look at your leadership team and ask whether each person is genuinely the best person for that seat given where the company is going, not where it's been. The corollary: who am I missing?",
        layer: "operating"
      },
      {
        number: 4,
        title: "The Time",
        coreQuestion: "Am I spending my time on the things that only I can do?",
        sharpenerQuestion: "What did I do this week that I'll still be doing a year from now if I don't change something?",
        context:
          "The replaceability principle turned into a daily question. Every time you sit down to do something, ask whether this is CEO work or operator work. Not to make you feel guilty, but to keep you honest. Everything that isn't only-you work is a delegation opportunity you haven't acted on yet.",
        layer: "operating"
      },
      {
        number: 5,
        title: "The Culture",
        coreQuestion: "What behavior am I rewarding, and is it the behavior I actually want?",
        sharpenerQuestion: "If a new hire watched how we operate for a month, what would they conclude actually matters here?",
        context:
          "If you reward firefighting, you get arsonists. If you reward quiet competence, you get people who build things that work. Every system you build, every conversation you have, every person you promote sends a signal about what matters. Make sure the signal matches what you actually want.",
        layer: "operating"
      },
      {
        number: 6,
        title: "The Model",
        coreQuestion: "How do we actually make money, and is that the best way to make money?",
        sharpenerQuestion: "If a customer gives us a dollar, where does it go and how many more dollars does it create?",
        context:
          "Most CEOs can't articulate their unit economics cleanly. What does a customer cost to acquire? What's their lifetime value? Where's the margin? What's recurring versus one-time? The question forces you to look at the architecture of how revenue works, not just the top line number.",
        layer: "operating"
      },
      {
        number: 7,
        title: "The Horizon",
        coreQuestion: "What is going to be true in 12 months that isn't true today, and are we positioned for it?",
        sharpenerQuestion: "What are we building today that becomes irrelevant if the industry shifts?",
        context:
          "This isn't about being paranoid. It's about not being surprised. If the landscape changes, what happens to your lead engine? Your offerings? Your moat? The question forces proactive positioning instead of reactive scrambling.",
        layer: "operating"
      },
      {
        number: 8,
        title: "The Truth",
        coreQuestion: "What am I not seeing because I don't want to see it?",
        sharpenerQuestion: "What would my harshest critic say about this company, and where would they be right?",
        context:
          "Every CEO has blind spots, and they're usually in the places that would require uncomfortable action. The question isn't whether you have blind spots. It's whether you have a system for surfacing them.",
        layer: "operating"
      },
      {
        number: 9,
        title: "The Story",
        coreQuestion: "Can I explain in two sentences what we do, why it matters, and why we win?",
        sharpenerQuestion: "Could my clients explain what we do to their friends over dinner?",
        context:
          "Not for a pitch deck — for yourself. Because if you can't, your team definitely can't, and your customers definitely can't explain it to their friends. Referral-driven growth requires that your story be so clear and compelling that it survives retelling.",
        layer: "operating"
      }
    ]
  },
  {
    group: "Deeper Questions",
    layer: "deeper",
    items: [
      {
        number: 10,
        title: "The Identity",
        coreQuestion: "What kind of company am I actually building?",
        sharpenerQuestion: "If I got exactly what I wanted, what does this look like in five years and is that what I'm actually optimizing for?",
        context:
          "This is the question underneath every other question. Are you building to sell? A profitable lifestyle business? Something venture-scale? The answer changes literally everything — funding, leadership, urgency, equity. Because the identity of the company is undefined, every decision feels ambiguous.",
        layer: "deeper"
      },
      {
        number: 11,
        title: "The Compound Effect",
        coreQuestion: "Of everything I'm doing this week, what will still be producing value in a year?",
        sharpenerQuestion: "What percentage of my week is spent on things that compound vs. things that expire?",
        context:
          "Some activities produce value today and that's it. Some produce value that grows over time. A talk is linear — you give it and it's done. A case study is compounding — every one makes the next sale easier. A second leader is compounding — every hour invested pays dividends for years. Ruthlessly shift time toward compounding activities.",
        layer: "deeper"
      },
      {
        number: 12,
        title: "The Personal Ceiling",
        coreQuestion: "Who do I need to become for the company to get what it needs?",
        sharpenerQuestion: "What conversation am I avoiding right now, and what is it costing us every day I don't have it?",
        context:
          "The company's ceiling is usually the CEO's ceiling. Not in terms of intelligence or skill, but in terms of the personal limitations that constrain how you lead. The question isn't 'what does the company need?' — it's 'what do I personally need to change about how I operate?'",
        layer: "deeper"
      },
      {
        number: 13,
        title: "The Kill Shot",
        coreQuestion: "What would kill us?",
        sharpenerQuestion: "If a competitor studied our business for a month, where would they attack?",
        context:
          "Map the fragility of the business. What if your lead engine changes? What if you're out for three months? What if a well-funded competitor enters with your model but more resources? These aren't paranoid scenarios — they're the kind of thing a CEO should have at least a rough contingency for. The goal over time is antifragility.",
        layer: "deeper"
      },
      {
        number: 14,
        title: "The Ask",
        coreQuestion: "What am I afraid to ask for?",
        sharpenerQuestion: "What are we afraid to ask our customers for?",
        context:
          "Every business has a growth rate limited by the founder's willingness to ask for things. Are you asking for referrals? Testimonials? Case studies? More involvement from your team? You're comfortable giving value. You're less comfortable requesting it back. And in a referral-driven business, the ask is the mechanism that turns delivered value into new business.",
        layer: "deeper"
      }
    ]
  }
];

const ALL_QUESTIONS = QUESTIONS.flatMap((g) => g.items);

export function CeoQuestionsScreen(): JSX.Element {
  const actions = useAppActions();
  const [spotlightIndex, setSpotlightIndex] = useState(() =>
    Math.floor(Math.random() * ALL_QUESTIONS.length)
  );
  const spotlight = ALL_QUESTIONS[spotlightIndex];
  const [discussInput, setDiscussInput] = useState("");

  function handleDiscussSubmit(): void {
    const text = discussInput.trim();
    if (!text) return;

    const context = [
      `I'm reflecting on CEO Question #${spotlight.number}: "${spotlight.title}"`,
      "",
      `> Core: ${spotlight.coreQuestion}`,
      "",
      `> Sharpener: ${spotlight.sharpenerQuestion}`,
      "",
      `> ${spotlight.context}`,
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
    <section className="screen ceo-questions-screen">
      <div className="screen-header">
        <h2>The 14 CEO Questions</h2>
        <p>
          The questions every CEO should be asking — nine operating questions to cycle through
          weekly, and five deeper questions that shape everything else.
        </p>
      </div>

      <div className="spotlight-card">
        <div className="spotlight-label">Today's question</div>
        <div className="spotlight-number">{spotlight.number}</div>
        <h3 className="spotlight-title">{spotlight.title}</h3>
        <p className="spotlight-description">{spotlight.coreQuestion}</p>
        <p className="ceo-q-sharpener">{spotlight.sharpenerQuestion}</p>
        <div className="spotlight-narrative">{spotlight.context}</div>
        <span className={`ceo-q-layer ceo-q-layer--${spotlight.layer}`}>
          {spotlight.layer === "operating" ? "Operating" : "Deeper"}
        </span>

        <div className="spotlight-discuss">
          <input
            className="spotlight-discuss-input"
            type="text"
            placeholder="What's on your mind about this question?"
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

      {QUESTIONS.map((group) => (
        <div className="card" key={group.group}>
          <h3>{group.group}</h3>
          <p className="ceo-q-group-hint">
            {group.layer === "operating"
              ? "Cycle through these weekly or monthly."
              : "These don't change week to week — they sit in the back of your mind and shape everything else."}
          </p>
          {group.items.map((q) => (
            <div
              className={`principle-item${q.number === spotlight.number ? " principle-active" : ""}`}
              key={q.number}
              onClick={() => setSpotlightIndex(ALL_QUESTIONS.indexOf(q))}
            >
              <span className="principle-number">{q.number}</span>
              <div>
                <strong>{q.title}</strong>
                <p>{q.coreQuestion}</p>
                <p className="ceo-q-sharpener-inline">{q.sharpenerQuestion}</p>
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
