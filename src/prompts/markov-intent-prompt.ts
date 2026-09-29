import { noul } from '@typesafe-ai/sdk';

// Jev reads questions literally, so each Noul spells out its boundary cases instead of relying on a shared preamble.
export const MARKOV_ADDRESSED_QUESTION = noul(
	'Is the author of `message.content` speaking directly to Markov, a Discord bot, as the intended listener of the message?',
	{
		true: [
			'The message talks to Markov by name, for example asking Markov a question, giving Markov a request or command, or greeting Markov.',
			'Examples: "markov what should I eat tonight", "Markov stop hiding the cookies", "yo markov".',
		],
		false: [
			'The message talks about Markov to other people instead of to Markov: third-person comments, jokes, criticism, or questions such as "is markov broken again?".',
			'Statements about what Markov can do or owns, or what someone will change about Markov, such as "markov can see images now".',
			'Requests to another person to change, control, or provoke Markov.',
			'The recipient is ambiguous, or "markov" refers to Markov chains, Markov models, or is used incidentally.',
		],
	},
);

export const MARKOV_CONTINUATION_QUESTION = noul(
	'Markov, a Discord bot, just replied to the author of `message.content`. Is `message.content` a continuation of that exchange directed at Markov?',
	{
		true: 'The message answers Markov\'s question, asks Markov a follow-up, asks Markov to elaborate, or responds to Markov\'s reply in a way that invites an answer.',
		false: 'The message starts an unrelated topic, is addressed to the channel or another person, or closes the exchange without inviting a reply.',
	},
);

// Jokes and banter about Markov scored as praise under a broader question, so only celebratory moments count.
export const MARKOV_REACT_QUESTION = noul(
	'Is `message.content` a clear moment worth celebrating or acknowledging, such that a single emoji reaction from Markov, a Discord bot, would be welcome without Markov joining the conversation?',
	{
		true: 'Good news, a milestone or achievement, a celebration such as a birthday, or an excited announcement shared with the channel.',
		false: [
			'Jokes, banter, memes, teasing, or comments about Markov, even when funny or complimentary.',
			'Routine chatter, reactions like "lol" or "lmao", logistics, plain questions, and ambiguous context.',
			'Serious or sensitive subjects where a reaction could seem insensitive.',
		],
	},
);
