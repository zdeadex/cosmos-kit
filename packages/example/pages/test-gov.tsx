import { Button } from "@chakra-ui/react";
import { useEffect } from "react";
import { cosmos } from 'interchain';
import { useWallet } from "@cosmos-kit/react";
// import { gasEstimation } from "../utils/tmp";
// import { signAndBroadcast } from 'cosmjs-utils';

const {
    vote: createVoteMsg
} = cosmos.gov.v1beta1.MessageComposer.fromPartial;

export default () => {
    const walletManager = useWallet();
    const { stargateClient, connect, setCurrentWallet, setCurrentChain, address } = walletManager;

    useEffect(() => {
        const fn = async () => {
            setCurrentWallet('keplr');
            setCurrentChain('osmosis');
            await connect();
        }
        fn();
    }, [])

    const onClick = async () => {
        const _stargateClient = await stargateClient;
        if (!_stargateClient || !address) {
            console.error('stargateClient undefined or address undefined.')
            return;
        }

        const voteMessages = [];

        voteMessages.push({
            typeUrl: '/cosmos.gov.v1beta1.MsgVote',
            value: {
                voter: address,
                proposalId: "330",
                option: 1
            }
        });

        const fee = {
            amount: [{
                denom: 'uosmo',
                amount: '0',
            }],
            gas: '200000',
        }

        const res = await _stargateClient.signAndBroadcast(address, voteMessages, fee, '');
        console.log(111, res)
    }

    return (
        <div>
            <Button onClick={onClick}>Vote</Button>
        </div>
    )
}