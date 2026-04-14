# Cigar Meetup Discord Bot (MVP)

MVP target: create meetup time-vote polls in Discord.

## Features (v0)
- `/meetup_vote` slash command
- Optional cigar field + optional lounge channel target
- Optional `create_event` toggle
- Up to 5 time options
- Button-based voting
- Live vote tally updates in the message
- `Close Poll` button (creator or server manager)
- Winner summary on close (or tie/no-votes handling)
- On close: creates a new thread in target channel with title/time/cigar
- Optional: creates a Discord scheduled event
- `/bookmark_submit` for user-suggested sites (pending queue)
- `/bookmark_approve` to publish approved bookmarks into `#bookmarks`

## Setup
```bash
cd cigar-meetup-bot
npm install
cp .env.example .env
# fill in token/client/guild ids
npm run register
npm run dev
```

## Command
`/meetup_vote title:<text> option1:<text> option2:<text> [option3] [option4] [option5] [cigar] [lounge_channel] [create_event]`

Example:
`/meetup_vote title:"Saturday Smoke Session" cigar:"Padron 1964" option1:"Sat 7:00 PM" option2:"Sat 8:30 PM" option3:"Sun 3:00 PM" lounge_channel:#lounge create_event:true`

## Notes
- Votes are one-user-one-vote per poll.
- Poll state is in-memory for now (simple MVP).
