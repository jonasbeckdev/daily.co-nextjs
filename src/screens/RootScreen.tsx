import { useCallback, useEffect, useState } from 'react';
import { STATE_CREATING, STATE_ERROR, STATE_HAIRCHECK, STATE_IDLE, STATE_JOINED, STATE_JOINING, STATE_LEAVING } from 'modules/constants';
import api from 'modules/api'
import DailyIframe, { DailyCall, DailyEvent } from '@daily-co/daily-js';
import {pageUrlFromRoomUrl, roomUrlFromPageUrl} from 'modules/utils'
import { DailyProvider } from '@daily-co/daily-react';
import { Call, HairCheck, Header, Tray } from 'components';
import { HomeScreen } from 'screens';

export function RootScreen() {
  const [appState, setAppState] = useState(STATE_IDLE);
  const [roomUrl, setRoomUrl] = useState<string|null>(null);
  const [callObject, setCallObject] = useState<DailyCall|null>(null);
  const [apiError, setApiError] = useState(false);

  /**
   * Create a new call room. This function will return the newly created room URL.
   * We'll need this URL when pre-authorizing (https://docs.daily.co/reference/rn-daily-js/instance-methods/pre-auth)
   * or joining (https://docs.daily.co/reference/rn-daily-js/instance-methods/join) a call.
   */
  const createCall = useCallback(() => {
    setAppState(STATE_CREATING);
    return api
      .createRoom()
      .then((room) => room.url)
      .catch((error) => {
        console.error('Error creating room', error);
        setRoomUrl(null);
        setAppState(STATE_IDLE);
        setApiError(true);
      });
  }, []);

  /**
   * We've created a room, so let's start the hair check. We won't be joining the call yet.
   */
  const startHairCheck = useCallback(async (url: string) => {
    const newCallObject = DailyIframe.createCallObject();
    setRoomUrl(url);
    setCallObject(newCallObject);
    setAppState(STATE_HAIRCHECK);
    await newCallObject.preAuth({ url }); // add a meeting token here if your room is private
    await newCallObject.startCamera();
  }, []);

  /**
   * Once we pass the hair check, we can actually join the call.
   */
  const joinCall = useCallback(() => {
    if (callObject && roomUrl) {
      callObject.join({ url: roomUrl });
    }
  }, [callObject, roomUrl]);

  /**
   * Start leaving the current call.
   */
  const startLeavingCall = useCallback(() => {
    if (!callObject) return;
    // If we're in the error state, we've already "left", so just clean up
    if (appState === STATE_ERROR) {
      callObject.destroy().then(() => {
        setRoomUrl(null);
        setCallObject(null);
        setAppState(STATE_IDLE);
      });
    } else {
      /* This will trigger a `left-meeting` event, which in turn will trigger
      the full clean-up as seen in handleNewMeetingState() below. */
      setAppState(STATE_LEAVING);
      callObject.leave();
    }
  }, [callObject, appState]);

  /**
   * If a room's already specified in the page's URL when the component mounts,
   * join the room.
   */
  useEffect(() => {
    const url = roomUrlFromPageUrl();
    if (url) {
      startHairCheck(url);
    }
  }, [startHairCheck]);

  /**
   * Update the page's URL to reflect the active call when roomUrl changes.
   */
  useEffect(() => {
    const pageUrl = pageUrlFromRoomUrl(roomUrl);
    if (pageUrl === window.location.href) return;
    window.history.replaceState(null, '', pageUrl);
  }, [roomUrl]);

  function handleNewMeetingState() {
    if (callObject) {
      switch (callObject.meetingState()) {
        case 'joined-meeting':
          setAppState(STATE_JOINED);
          break;
        case 'left-meeting':
          callObject.destroy().then(() => {
            setRoomUrl(null);
            setCallObject(null);
            setAppState(STATE_IDLE);
          });
          break;
        case 'error':
          setAppState(STATE_ERROR);
          break;
        default:
          break;
      }
    }
  }
  /**
   * Update app state based on reported meeting state changes.
   *
   * NOTE: Here we're showing how to completely clean up a call with destroy().
   * This isn't strictly necessary between join()s, but is good practice when
   * you know you'll be done with the call object for a while, and you're no
   * longer listening to its events.
   */
  useEffect(() => {
    if (callObject) {

      const events: DailyEvent[] = ['joined-meeting', 'left-meeting', 'error', 'camera-error'];


      // Use initial state
      handleNewMeetingState();

      /*
      * Listen for changes in state.
      * We can't use the useDailyEvent hook (https://docs.daily.co/reference/daily-react/use-daily-event) for this
      * because right now, we're not inside a <DailyProvider/> (https://docs.daily.co/reference/daily-react/daily-provider)
      * context yet. We can't access the call object via daily-react just yet, but we will later in Call.js and HairCheck.js!
      */
      events.forEach((event) => callObject.on(event, handleNewMeetingState));

      // Stop listening for changes in state
      return () => {
        events.forEach((event) => {
          callObject.off(event, handleNewMeetingState)
        });
      };
    }
  }, [callObject]);

  /**
   * Show the call UI if we're either joining, already joined, or have encountered
   * an error that is _not_ a room API error.
   */
  const showCall = !apiError && [STATE_JOINING, STATE_JOINED, STATE_ERROR].includes(appState);

  /* When there's no problems creating the room and startHairCheck() has been successfully called,
   * we can show the hair check UI. */
  const showHairCheck = !apiError && appState === STATE_HAIRCHECK;

  const renderApp = () => {
    // If something goes wrong with creating the room.
    if (apiError) {
      return (
        <div className="api-error">
          <h1>Error</h1>
          <p>
            Room could not be created. Check if your `.env` file is set up correctly. For more
            information, see the{' '}
            <a href="https://github.com/daily-demos/custom-video-daily-react-hooks#readme">
              readme
            </a>{' '}
            :
          </p>
          <p>{apiError}</p>
        </div>
      );
    }
    // No API errors? Let's check our hair then.
    if (showHairCheck && callObject) {
      return (
        <DailyProvider callObject={callObject}>
          <HairCheck joinCall={joinCall} cancelCall={startLeavingCall} />
        </DailyProvider>
      );
    }

    // No API errors, we passed the hair check, and we've joined the call? Then show the call.
    if (showCall && callObject) {
      return (
        <DailyProvider callObject={callObject}>
          <Call />
          <Tray leaveCall={startLeavingCall} />
        </DailyProvider>
      );
    }

    // The default view is the HomeScreen, from where we start the demo.
    return <HomeScreen createCall={createCall} startHairCheck={startHairCheck} />;
  };

  return (
    <div className="app">
      <Header />
      {renderApp()}
    </div>
  );
}
