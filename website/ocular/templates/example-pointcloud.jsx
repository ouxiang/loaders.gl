import React from 'react';

import { AutoSizer } from 'react-virtualized';

import { MainExample } from 'ocular-gatsby/src/components/styled';
import WithConfig from 'ocular-gatsby/src/components/layout/website-config';

import {App} from '../../../examples/pointcloud/app';

export default App;

/*
export default class PointCloudExample extends React.Component {
  render() {
    // const { pathContext } = this.props;
    const { pageResources } = this.props;
    // const { slug } = pathContext;

    return (
      <WithConfig>
        {({ theme }) => (
          <MainExample theme={theme}>
            <App/>
          </MainExample>
          )}
      </WithConfig>
    );
  }
}
*/
