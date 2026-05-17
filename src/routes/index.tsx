import { ChatCircleText } from '@phosphor-icons/react'
import { createFileRoute } from '@tanstack/react-router'

import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'

const phoneNumber = '+1 (415) 555-0198'
const messageHref =
  'sms:+14155550198&body=Hi%20Gavel%2C%20I%20want%20to%20sell%20something.'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main className="relative min-h-svh overflow-hidden bg-black font-sans text-white">
      <img
        src="/gavel-desk-bg.png"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.22)_0%,rgba(0,0,0,0.12)_44%,rgba(0,0,0,0.5)_100%)]" />
      <div className="absolute right-[8.5vw] bottom-[4vh] hidden h-[12vh] w-[26vw] rounded-full bg-black/80 blur-2xl md:block" />
      <div className="absolute right-[13vw] top-[17vh] hidden h-[55vh] w-[25vw] rounded-full bg-white/7 blur-3xl md:block" />
      <img
        src="/gavel-phone-angled.png"
        alt=""
        aria-hidden="true"
        className="absolute right-[8.5vw] bottom-[-2vh] hidden h-[86vh] max-h-[930px] min-h-[680px] w-auto drop-shadow-[0_38px_84px_rgba(0,0,0,0.8)] md:block xl:right-[11vw] xl:h-[88vh]"
      />
      <img
        src="/gavel-phone-angled.png"
        alt=""
        aria-hidden="true"
        className="absolute right-[-24vw] bottom-[-10vh] h-[62vh] w-auto drop-shadow-[0_28px_64px_rgba(0,0,0,0.74)] md:hidden"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0)_22%,rgba(0,0,0,0.12)_100%)]" />

      <section className="relative z-10 grid min-h-svh grid-rows-[auto_1fr]">
        <Header />

        <div className="mx-auto flex w-full max-w-[1440px] items-center px-7 py-10 sm:px-12 lg:px-20 lg:py-0">
          <HeroCopy />
        </div>
      </section>
    </main>
  )
}

function Header() {
  return (
    <header className="flex h-[92px] items-center justify-between border-b border-white/12 px-7 sm:px-12 lg:px-20">
      <a
        href="/"
        className="font-serif text-[2.45rem] leading-none font-semibold tracking-[-0.03em] text-white"
      >
        Gavel
      </a>

      <a
        href={messageHref}
        className={cn(
          buttonVariants({ size: 'lg' }),
          'h-12 rounded-xl border-[#0a84ff] bg-[#0a84ff] px-5 text-[1.35rem] font-medium tracking-[-0.03em] text-white shadow-[0_0_34px_rgba(10,132,255,0.28)] hover:bg-[#0577ed]',
        )}
      >
        <ChatCircleText className="size-5" weight="fill" />
        Message
      </a>
    </header>
  )
}

function HeroCopy() {
  return (
    <div className="max-w-[620px] pb-8 lg:-mt-4">
      <h1 className="max-w-[11ch] text-[4.4rem] leading-[0.95] font-semibold tracking-[-0.06em] text-balance text-white drop-shadow-[0_7px_32px_rgba(255,255,255,0.16)] sm:text-[5.6rem] lg:text-[6.1rem]">
        Sell stuff by texting Gavel
      </h1>

      <p className="mt-7 max-w-xl text-[1.42rem] leading-[1.34] font-medium tracking-[-0.035em] text-white/70 sm:text-[1.72rem]">
        Tell it what you want to sell. It creates the listing, handles buyer
        demand, compares offers, and texts before it acts.
      </p>

      <div className="mt-10 flex flex-col items-start gap-4">
        <a
          href={messageHref}
          className={cn(
            buttonVariants({ size: 'lg' }),
            'h-[84px] w-full rounded-2xl border-[#0a84ff] bg-[#0a84ff] px-6 text-[1.42rem] font-medium tracking-[-0.04em] text-white shadow-[0_18px_54px_rgba(10,132,255,0.36)] hover:bg-[#0577ed] sm:w-auto sm:px-7 sm:text-[1.6rem]',
          )}
        >
          <span className="flex size-12 items-center justify-center rounded-xl bg-[#34c759] shadow-inner shadow-white/25">
            <ChatCircleText className="size-8 text-white" weight="fill" />
          </span>
          Message {phoneNumber}
        </a>
        <p className="pl-1 text-[1.05rem] leading-6 text-white/58">
          Opens Messages. No marketplace account setup.
        </p>
      </div>
    </div>
  )
}
